package com.tbfirst.auth;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;

/**
 * tbfirst-auth 认证中心启动类。
 *
 * <p>架构角色：tbfirst 微服务平台的身份服务，负责用户登录、JWT 签发、
 * admin/employee 两级角色管理以及管理员用户 CRUD。</p>
 */
@EnableDiscoveryClient
@EnableFeignClients(basePackages = "com.tbfirst.auth.client")
@SpringBootApplication(scanBasePackages = "com.tbfirst")
@MapperScan("com.tbfirst.auth.mapper")
public class AuthApplication {
    public static void main(String[] args) {
        SpringApplication.run(AuthApplication.class, args);
    }
}
