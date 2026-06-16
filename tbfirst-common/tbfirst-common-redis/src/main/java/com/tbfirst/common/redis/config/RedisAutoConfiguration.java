package com.tbfirst.common.redis.config;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.jsontype.impl.LaissezFaireSubTypeValidator;
import com.tbfirst.common.redis.lock.RedisLock;
import org.redisson.api.RedissonClient;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;
import org.springframework.data.redis.serializer.StringRedisSerializer;

/**
 * Redis 自动装配。
 * <p>
 * 仅在类路径同时存在 Spring Data Redis 与 Redisson 客户端时激活。
 * 为业务提供：
 * <ul>
 *   <li>通用 {@link RedisTemplate}（String key + Jackson Object value，JSON 序列化）</li>
 *   <li>{@link RedisLock} 分布式锁（基于 Redisson RLock，自动释放 + 可重入 + Lua 原子）</li>
 * </ul>
 * Redisson Spring Boot starter 自身负责装配 {@link RedissonClient} 与 {@code RedissonConnectionFactory}，
 * 本类只在其上叠加 tbfirst 项目所需的 Bean。
 * </p>
 *
 * @author tbfirst
 */
@AutoConfiguration
@ConditionalOnClass({RedisConnectionFactory.class, RedissonClient.class})
public class RedisAutoConfiguration {

    /**
     * 自定义通用 RedisTemplate：String key + Jackson Object value。
     * <p>
     * 默认 JdkSerializer 可读性差、跨语言困难，故替换为 JSON 序列化；
     * 启用 DefaultTyping 以便反序列化时保留对象真实类型。Redisson starter
     * 注入的 {@code RedissonConnectionFactory} 透明工作，无需特殊处理。
     * </p>
     *
     * @param cf Redis 连接工厂（由 Redisson starter 提供）
     * @return 配置完成的 RedisTemplate
     */
    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate")
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory cf) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(cf);

        StringRedisSerializer keySer = new StringRedisSerializer();

        ObjectMapper om = new ObjectMapper();
        om.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);
        om.activateDefaultTyping(LaissezFaireSubTypeValidator.instance,
                ObjectMapper.DefaultTyping.NON_FINAL);
        Jackson2JsonRedisSerializer<Object> valSer = new Jackson2JsonRedisSerializer<>(om, Object.class);

        template.setKeySerializer(keySer);
        template.setHashKeySerializer(keySer);
        template.setValueSerializer(valSer);
        template.setHashValueSerializer(valSer);
        template.afterPropertiesSet();
        return template;
    }

    /**
     * tbfirst 分布式锁工具，封装 Redisson RLock，提供 callback 风格 API。
     *
     * @param redisson Redisson 客户端（由 Redisson starter 自动装配）
     * @return 分布式锁单例
     */
    @Bean
    @ConditionalOnMissingBean
    public RedisLock tbfirstRedisLock(RedissonClient redisson) {
        return new RedisLock(redisson);
    }
}
