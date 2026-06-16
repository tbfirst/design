package com.tbfirst.cinestitch;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;

/**
 * tbfirst-cinestitch 微服务启动类。
 */
@EnableDiscoveryClient
@EnableFeignClients
@SpringBootApplication(scanBasePackages = "com.tbfirst")
@MapperScan("com.tbfirst.cinestitch.mapper")
public class CinestitchApplication {
    public static void main(String[] args) {
        SpringApplication.run(CinestitchApplication.class, args);
    }
}
