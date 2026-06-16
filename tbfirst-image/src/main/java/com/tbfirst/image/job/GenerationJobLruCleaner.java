package com.tbfirst.image.job;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.common.oss.StorageService;
import com.tbfirst.common.redis.key.RedisKeyBuilder;
import com.tbfirst.common.redis.lock.RedisLock;
import com.tbfirst.image.entity.GenerationJob;
import com.tbfirst.image.mapper.GenerationJobMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 生图记录 LRU 清理定时任务。
 *
 * <p><b>清理对象：</b>{@code last_access_at < (now - app.lru.ttl-days)} 的所有任务
 * （默认 30 天）。{@code saved=true}（用户已显式"下载并收藏"）的行同样在清理范围内 ——
 * "下载并收藏"只是当时把 {@code last_access_at} 刷到 now，后续 30 天内若用户没再续命
 * 仍然会被清；前端 HistoryModal 文案也明确告知"再过 30 天没续仍会被清"。</p>
 *
 * <p><b>实际行为：</b>
 * <ul>
 *   <li>底层存储：逐个 {@link StorageService#delete(String)} —— provider=gcs 走 Cloud
 *       Storage API <em>真物理删除 Blob</em>；provider=local 删本地磁盘文件。删除失败
 *       仅 log.warn，不中断流程。</li>
 *   <li>DB 行：{@code BaseMapper.deleteBatchIds} 走 BaseEntity 的 {@code @TableLogic}
 *       <em>软删除</em>（{@code deleted} 置 1），并非物理删。后续 history 查询的
 *       {@code WHERE deleted=0} 自动过滤掉。审计/反查场景仍可按 jobId 拿到原始行。</li>
 * </ul>
 * 旧版本注释曾写"DB 物理删除"，与代码实际行为（@TableLogic 软删）不符，已修正。</p>
 *
 * <p>多实例部署下用 {@link RedisLock} 抢分布式锁，确保同一调度周期内只有一个
 * image 实例真正执行扫描+删除；未抢到锁的实例直接跳过本次执行。</p>
 */
@Slf4j
@Component
@RequiredArgsConstructor
// 该注解表示可通过配置项 app.lru.enabled 来控制是否启用该定时任务，配置项不存在时默认是已启用（matchIfMissing = true）
// 如果真要关，必须显式写 app.lru.enabled: false 或设环境变量 APP_LRU_ENABLED=false。
@ConditionalOnProperty(name = "app.lru.enabled", havingValue = "true", matchIfMissing = true)
public class GenerationJobLruCleaner {

    /** 分布式锁 key，最终值 {@code tbfirst:lock:lru-cleaner} */
    private static final String LOCK_KEY = RedisKeyBuilder.key("lock", "lru-cleaner");
    /** 锁租期：单次清理最坏情况内足够跑完；到期 Redisson 自动释放避免死锁 */
    private static final Duration LOCK_LEASE = Duration.ofMinutes(30);

    private final GenerationJobMapper mapper;
    private final StorageService storage;
    private final RedisLock redisLock;

    @Value("${app.lru.ttl-days:30}")
    private int ttlDays;

    @Scheduled(cron = "${app.lru.cron:0 0 3 * * *}")
    @Transactional
    public void cleanup() {
        boolean ran = redisLock.tryLock(LOCK_KEY, LOCK_LEASE, this::doCleanup);
        if (!ran) {
            log.info("[LRU] skipped: another image instance holds the lock");
        }
    }

    /** 真实清理逻辑，由 {@link #cleanup()} 在抢锁成功后调用 */
    private void doCleanup() {
        LocalDateTime threshold = LocalDateTime.now().minusDays(ttlDays);
        List<GenerationJob> expired = mapper.selectList(
                new LambdaQueryWrapper<GenerationJob>()
                        .lt(GenerationJob::getLastAccessAt, threshold));
        if (expired.isEmpty()) {
            log.info("[LRU] nothing to clean (threshold={}, ttlDays={})", threshold, ttlDays);
            return;
        }

        int fileOk = 0, fileFail = 0;
        for (GenerationJob j : expired) {
            if (j.getAssetUrls() == null || j.getAssetUrls().isBlank()) continue;
            for (String url : j.getAssetUrls().split("\n")) {
                if (url.isBlank()) continue;
                String key = url.startsWith("/static/") ? url.substring("/static/".length()) : url;
                try {
                    storage.delete(key);
                    fileOk++;
                } catch (Exception e) {
                    log.warn("[LRU] delete file failed key={} jobId={} err={}", key, j.getId(), e.getMessage());
                    fileFail++;
                }
            }
        }

        // 软删除（BaseEntity 的 @TableLogic 把 deleteBatchIds 改写为 UPDATE ... SET deleted=1）。
        // 满足"行不再被 history 查到 + 审计场景仍可按 jobId 反查"的双重需求。
        mapper.deleteBatchIds(expired.stream().map(GenerationJob::getId).toList());
        log.info("[LRU] cleaned expired jobs: rows={} files_ok={} files_fail={} threshold={} ttlDays={}",
                expired.size(), fileOk, fileFail, threshold, ttlDays);
    }
}
