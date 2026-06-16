package com.tbfirst.image.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.image.entity.GenerationJob;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 生图任务 Mapper：对应 {@code image.generation_job}。
 *
 * <p><b>自定义 SQL 分布：</b></p>
 * <ul>
 *   <li>聚合查询 / 多条件 OR → {@code resources/mapper/GenerationJobMapper.xml}；</li>
 *   <li>诊断用一次性查询 → 直接用 {@code @Select} 注解内联，不进 XML。</li>
 * </ul>
 *
 * <p><b>JSONB 支持：</b>{@code phase_config} 列的 String↔PGobject 往返由实体上的
 * {@code PgJsonbStringTypeHandler} 承担；需要实体类 {@code @TableName(autoResultMap = true)}
 * 才会在 SELECT 路径上也应用 TypeHandler。</p>
 */
public interface GenerationJobMapper extends BaseMapper<GenerationJob> {

    /**
     * 按 userId 批量聚合成功生图次数。供 auth 服务 Feign 调用（admin 用户列表页汇总用）。
     *
     * <p>SQL（见 XML）：
     * <pre>
     * SELECT user_id AS "userId", COUNT(*) AS cnt
     * FROM image.generation_job
     * WHERE status = 'success' AND deleted = 0
     *   AND user_id IN (...)
     * GROUP BY user_id
     * </pre>
     *
     * @return 每行 {@code {userId: Long, cnt: Long}} 的 map 列表；Service 层会转成 {@code Map<Long, Long>}
     */
    List<Map<String, Object>> countSuccessByUserIds(@Param("userIds") Collection<Long> userIds);

    /**
     * 历史列表：本人 + 同组互见，按 id 倒序，最多 200 行。
     *
     * <p>SQL（见 XML）：
     * <pre>
     * SELECT * FROM image.generation_job
     * WHERE deleted = 0
     *   AND ( user_id = #{userId}
     *         OR ( #{groupId} IS NOT NULL AND group_id = #{groupId} ) )
     * ORDER BY id DESC LIMIT 200
     * </pre>
     *
     * @param groupId 可为 null；为 null 时退化为"只看本人任务"
     */
    List<GenerationJob> findTop200VisibleToUser(@Param("userId") Long userId,
                                                @Param("groupId") Long groupId);

    /**
     * 标记"已收藏 / 已下载"：同时把 saved=TRUE、last_access_at 刷新。
     *
     * <p>SQL（见 XML）：
     * <pre>
     * UPDATE image.generation_job
     * SET saved = TRUE, last_access_at = #{now}
     * WHERE id = #{id} AND deleted = 0
     *   AND ( user_id = #{userId}
     *         OR ( #{groupId} IS NOT NULL AND group_id = #{groupId} ) )
     * </pre>
     *
     * <p>鉴权放在 WHERE 里一次完成：调用方不是作者也不是同组成员，
     * 则 affected rows = 0，Service 层据此抛 404。</p>
     *
     * @return 实际更新行数（1 = 成功；0 = 不存在 / 越权 / 已软删）
     */
    int markSaved(@Param("id") Long id,
                  @Param("userId") Long userId,
                  @Param("groupId") Long groupId,
                  @Param("now") LocalDateTime now);

    /**
     * 诊断查询：status 分布（每个 status 多少行、多少 user_id 非空）。
     * <p>SQL：{@code SELECT status, COUNT(*) total, COUNT(user_id) non_null_user_id
     * FROM image.generation_job GROUP BY status}。只在排障接口里调用。</p>
     */
    @Select("SELECT status AS status, COUNT(*) AS total, COUNT(user_id) AS non_null_user_id " +
            "FROM image.generation_job GROUP BY status")
    List<Map<String, Object>> debugStatusDistribution();

    /**
     * 诊断查询：统计 user_id 为 null 的脏数据行数。
     * <p>SQL：{@code SELECT COUNT(*) FROM image.generation_job WHERE user_id IS NULL}。</p>
     */
    @Select("SELECT COUNT(*) FROM image.generation_job WHERE user_id IS NULL")
    long debugCountNullUserId();
}
