package com.tbfirst.common.redis.lock;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;

import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * 基于 Redisson 的分布式锁封装。
 * <p>
 * 提供 callback 风格 API（业务无须 try/finally），底层自动用 Lua 脚本保证原子性，
 * 支持可重入与异常安全释放。由 {@code RedisAutoConfiguration} 装配为单例 Bean。
 * </p>
 *
 * <pre>{@code
 * // 非阻塞，成功执行 action 自动释放
 * boolean ran = redisLock.tryLock("lru-cleaner", Duration.ofMinutes(5), () -> {
 *     cleaner.run();
 * });
 *
 * // 带返回值
 * String result = redisLock.tryLock("compute", Duration.ofSeconds(30), () -> heavyCompute());
 * }</pre>
 *
 * @author tbfirst
 */
@Slf4j
@RequiredArgsConstructor
public class RedisLock {

    /** Redisson 客户端，由自动装配注入 */
    private final RedissonClient redisson;

    /**
     * 非阻塞抢锁，成功则同步执行 action，执行完毕（含异常）自动释放锁。
     *
     * @param key       锁 key（建议走 {@link com.tbfirst.common.redis.key.RedisKeyBuilder}）
     * @param leaseTime 锁租期，到期自动释放，避免持锁实例宕机死锁
     * @param action    抢到锁后要执行的业务逻辑
     * @return true=抢到锁并执行了 action；false=未抢到锁
     */
    public boolean tryLock(String key, Duration leaseTime, Runnable action) {
        Boolean ran = tryLock(key, Duration.ZERO, leaseTime, () -> {
            action.run();
            return Boolean.TRUE;
        });
        return Boolean.TRUE.equals(ran);
    }

    /**
     * 带返回值的非阻塞抢锁。获锁失败返回 {@code null}。
     *
     * @param key       锁 key
     * @param leaseTime 锁租期
     * @param action    返回业务结果的 Supplier
     * @param <T>       结果类型
     * @return action 结果；获锁失败时为 null
     */
    public <T> T tryLock(String key, Duration leaseTime, Supplier<T> action) {
        return tryLock(key, Duration.ZERO, leaseTime, action);
    }

    /**
     * 完整版本：可指定等待时间。{@code waitTime=Duration.ZERO} 即非阻塞。
     * <p>
     * 抢锁成功后执行 action；执行完毕（无论正常返回或抛异常）在当前线程持有锁的前提下自动释放。
     * 若线程被中断，恢复中断标志并返回 null。
     * </p>
     *
     * @param key       锁 key
     * @param waitTime  抢锁最大等待时间
     * @param leaseTime 锁租期
     * @param action    业务逻辑
     * @param <T>       结果类型
     * @return action 结果；获锁失败或被中断时为 null
     */
    public <T> T tryLock(String key, Duration waitTime, Duration leaseTime, Supplier<T> action) {
        RLock lock = redisson.getLock(key);
        boolean acquired = false;
        try {
            acquired = lock.tryLock(waitTime.toMillis(), leaseTime.toMillis(), TimeUnit.MILLISECONDS);
            if (!acquired) {
                log.debug("RedisLock: failed to acquire {}", key);
                return null;
            }
            return action.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("RedisLock: interrupted while acquiring {}", key);
            return null;
        } finally {
            // 仅释放当前线程持有的锁，避免误释放他人锁（重入计数由 Redisson 内部管理）
            if (acquired && lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
