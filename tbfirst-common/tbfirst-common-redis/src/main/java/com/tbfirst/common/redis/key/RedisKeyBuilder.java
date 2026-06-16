package com.tbfirst.common.redis.key;

/**
 * Redis 键构建器。
 * <p>
 * 统一前缀和分隔符，方便后续修改；避免多服务共用 Redis 时 key 冲突。
 * 例如：tbfirst:session:12345
 * </p>
 *
 * @author tbfirst
 */
public final class RedisKeyBuilder {

    /** 全平台统一前缀，便于在 Redis 中做租户/应用级别隔离 */
    public static final String PREFIX = "tbfirst";

    private RedisKeyBuilder() {}

    /**
     * 构建 Redis 键，格式：{@code PREFIX:namespace:part1:part2:...}
     *
     * @param namespace 命名空间（如 session / lock / cache）
     * @param parts     可变参数，拼接到 key 末尾
     * @return 完整 Redis key
     */
    public static String key(String namespace, Object... parts) {
        StringBuilder sb = new StringBuilder(PREFIX).append(':').append(namespace);
        for (Object p : parts) sb.append(':').append(p);
        return sb.toString();
    }
}
