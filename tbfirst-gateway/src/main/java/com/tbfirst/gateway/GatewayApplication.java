package com.tbfirst.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;

/**
 * tbfirst-gateway 网关服务启动类。
 *
 * <p>架构角色：作为 tbfirst 微服务平台（Spring Cloud + Nacos）的统一入口，
 * 基于 Spring Cloud Gateway 实现反向代理、路由转发和 JWT 预校验。</p>
 *
 * <p>使用场景：前端所有 /api/** 请求先经过本网关，由白名单/JWT 过滤器鉴权后，
 * 再根据 Nacos 服务发现结果转发到 auth/image 等下游微服务。</p>
 *
 * <ul>
 *   <li>{@link EnableDiscoveryClient} 启用 Nacos 服务发现，便于基于服务名路由</li>
 *   <li>{@link SpringBootApplication} 启用自动装配与组件扫描</li>
 * </ul>
 */
@EnableDiscoveryClient
@SpringBootApplication
public class GatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
