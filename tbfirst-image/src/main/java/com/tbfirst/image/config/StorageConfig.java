package com.tbfirst.image.config;

import com.tbfirst.common.oss.StorageService;
import com.tbfirst.common.oss.impl.GoogleCloudStorageService;
import com.tbfirst.common.oss.impl.LocalStorageService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ApplicationListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.core.env.Environment;

import java.util.Arrays;
import java.util.Map;

/**
 * 存储后端装配。
 *
 * <p>v3 起：通过 {@code app.storage.provider} 切换实现：</p>
 * <ul>
 *   <li>{@code local}（默认）→ {@link LocalStorageService}</li>
 *   <li>{@code gcs} → {@link GoogleCloudStorageService}（v3 S2 落地）</li>
 *   <li>{@code aliyun} / {@code minio} → 占位，暂未实现</li>
 * </ul>
 *
 * <p>路径 / 凭据来源统一收口到 {@link StorageProps}，旧的 {@code app.uploads.path} 保留作为兼容默认值。</p>
 *
 * @see StorageProps
 * @see StaticResourceConfig
 */
@Slf4j
@Configuration
@EnableConfigurationProperties(StorageProps.class)
public class StorageConfig {

    /**
     * 启动期无条件诊断：打印 active profiles + app.storage.provider 实际生效值 +
     * 实际装配到容器的 StorageService 实现类型。
     * <p>用于排查"profile 没激活 / 环境变量覆盖 / yml 加载顺序"导致 GCS bean 不装配的问题。</p>
     */
    @Bean
    public ApplicationListener<ContextRefreshedEvent> storageDiagnostics(StorageProps props, Environment env) {
        return event -> {
            StorageService bean = event.getApplicationContext().getBean(StorageService.class);
            String resolvedProvider = env.getProperty("app.storage.provider", "<missing>");
            String envOverride = env.getProperty("STORAGE_PROVIDER", "<unset in env>");
            log.info("==================================================");
            log.info("  Storage Diagnostics");
            log.info("  active profiles            = {}", Arrays.toString(env.getActiveProfiles()));
            log.info("  app.storage.provider (yml) = {}", resolvedProvider);
            log.info("  STORAGE_PROVIDER (env)     = {}", envOverride);
            log.info("  StorageProps.provider      = {}", props.getProvider());
            log.info("  bean type                  = {}", bean.getClass().getSimpleName());
            log.info("==================================================");
        };
    }

    /**
     * 装配本地存储 Bean。仅当 {@code app.storage.provider=local}（默认值）时生效。
     *
     * @param props 存储配置
     * @return LocalStorageService 实例
     */
    @Bean
    @ConditionalOnProperty(name = "app.storage.provider", havingValue = "local", matchIfMissing = true)
    public StorageService localStorageService(StorageProps props) {
        String path = props.getLocal().getPath();
        if (path == null || path.isBlank()) {
            // 兜底：若 app.storage.local.path 未配置，回退到旧 app.uploads.path 默认值
            path = "./data/uploads/image";
        }
        return new LocalStorageService(path);
    }

    /**
     * 装配 GCS 存储 Bean。仅当 {@code app.storage.provider=gcs} 时生效。
     *
     * <p>把 Spring-bound 的 {@link StorageProps.Gcs} 适配成纯 POJO 的 {@link GoogleCloudStorageService.Config}，
     * 维持 {@code tbfirst-common-oss} 模块「不依赖 spring-boot-starter」的设计原则。</p>
     *
     * @param props 存储配置
     * @return GoogleCloudStorageService 实例
     */
    @Bean
    @ConditionalOnProperty(name = "app.storage.provider", havingValue = "gcs")
    public StorageService gcsStorageService(StorageProps props) {
        StorageProps.Gcs g = props.getGcs();
        GoogleCloudStorageService.Config cfg = GoogleCloudStorageService.Config.of(
                g.getProjectId(),
                g.getBucket(),
                g.getCredentialsLocation(),
                g.getUrlMode(),
                g.getSignedUrlTtl(),
                g.getCdnDomain()
        );
        cfg.setProxyBaseUrl(g.getProxy().getBaseUrl());
        return new GoogleCloudStorageService(cfg);
    }

    /**
     * GCS 健康探针：注册到 {@code /actuator/health/gcs}，docker-compose 健康检查可指向它。
     * 仅 provider=gcs 时装配；探测一个不存在对象，404=UP（鉴权通了），401/403=DOWN（坑 12）。
     */
    @Bean("gcs")
    @ConditionalOnProperty(name = "app.storage.provider", havingValue = "gcs")
    public HealthIndicator gcsHealthIndicator(StorageService storageService) {
        return () -> {
            if (!(storageService instanceof GoogleCloudStorageService gcs)) {
                return Health.down().withDetail("reason", "storageService is not GCS").build();
            }
            Map<String, Object> probe = gcs.probe();
            String status = String.valueOf(probe.get("status"));
            Health.Builder b = "UP".equals(status) ? Health.up() : Health.down();
            probe.forEach((k, v) -> { if (!"status".equals(k)) b.withDetail(k, v); });
            return b.build();
        };
    }
}
