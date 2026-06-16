package com.tbfirst.auth.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * auth 服务 Flyway 自定义策略：repair → migrate。
 *
 * <p>为什么需要 repair（errorConclude #38 的延伸）：
 * <ul>
 *   <li>V1 迁移脚本（{@code V1__share_group.sql}）在开发期被更新过（增加了 IF NOT EXISTS 兜底
 *       以及其他优化），导致本地开发库的 flyway_schema_history 里记录的 checksum 与当前脚本不一致。</li>
 *   <li>Spring Boot 默认的 migrate-only 策略会在启动时直接抛 ValidateException，让服务根本起不来。</li>
 *   <li>{@code flyway.repair()} 先把 history 表里的 checksum 重新计算并写回 —— 对脚本是
 *       "纯幂等 DDL（IF NOT EXISTS）" 的情况这是安全的，因为实际 schema 不会因为 repair 而变化。</li>
 * </ul>
 * </p>
 *
 * <p>与 {@code tbfirst-image.FlywayConfig} 保持一致的策略，便于跨服务统一维护。</p>
 */
@Slf4j
@Configuration
public class FlywayConfig {

    /**
     * 覆盖默认 migrate-only 策略：repair → migrate。
     */
    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy() {
        return flyway -> {
            log.info("[Flyway] auth: repair() → migrate() — 允许已落地的 V1 迁移脚本被再次编辑（仅限幂等 DDL）");
            flyway.repair();
            flyway.migrate();
        };
    }
}
