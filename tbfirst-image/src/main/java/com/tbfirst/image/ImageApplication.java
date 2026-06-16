package com.tbfirst.image;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cloud.client.discovery.EnableDiscoveryClient;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * tbfirst-image 服务入口（端口 8102）。
 *
 * 扫描根设为 com.tbfirst 而非默认的 com.tbfirst.image，因为需要拉起 tbfirst-common-* 中的 Bean。
 * @MapperScan 同时扫本服务 mapper 与公共 asset 包（SharedAssetMapper）。
 */
@EnableDiscoveryClient
@EnableFeignClients
@EnableScheduling
@SpringBootApplication(scanBasePackages = "com.tbfirst")
@MapperScan({"com.tbfirst.image.mapper", "com.tbfirst.common.datasource.asset"})
public class ImageApplication {
    public static void main(String[] args) {
        SpringApplication.run(ImageApplication.class, args);
    }
}
