package com.tbfirst.image.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * Flyway 自定义执行策略 + 兜底 schema ensure。
 *
 * <p>三层防御：</p>
 * <ol>
 *   <li>{@code flyway.repair()}：同步 history 表的 checksum，消除 "V2 被改过" 导致的 ValidateException</li>
 *   <li>{@code flyway.migrate()}：执行未应用的脚本（V3 等）</li>
 *   <li>{@link #ensureColumns}：无视 Flyway 状态，直接用原生 JDBC 下发 {@code ALTER TABLE ... ADD COLUMN IF NOT EXISTS}
 *       把 saved / last_access_at 列补齐。<b>这是关键兜底</b>——开发期遇到过 history 标为 "V2 success"
 *       但实际列缺失的情况（Flyway 记账了但 DDL 没落地），本层保证无论上面两步如何，Hibernate 校验前
 *       两个列一定存在。</li>
 * </ol>
 *
 * <p>幂等性：全部用 {@code IF NOT EXISTS}，列/索引已存在则 no-op，开销接近 0。</p>
 *
 * <p>生产建议：稳定后可移除兜底层，仅保留 repair + migrate；或用 Profile 把本 Bean 限制在 dev/local。</p>
 */
@Slf4j
@Configuration
public class FlywayConfig {

    private final DataSource dataSource;

    public FlywayConfig(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /**
     * 覆盖 Spring Boot 默认的 migrate-only 策略：repair → migrate → ensureColumns。
     *
     * @return 策略 Bean，由 Spring Boot FlywayAutoConfiguration 在启动时调用一次
     */
    @Bean
    public FlywayMigrationStrategy flywayMigrationStrategy() {
        return flyway -> {
            log.info("[Flyway] repair() → migrate() → ensureColumns() — dev-friendly schema bootstrap");
            flyway.repair();
            flyway.migrate();
            ensureColumns();
        };
    }

    /**
     * 兜底：不查 Flyway history，直接确认 saved / last_access_at 列存在。
     * 如果 ALTER 真加了列（即之前 Flyway 没加到），会把所有现存 row 的 last_access_at 回填为 create_time。
     */
    private void ensureColumns() {
        try (Connection c = dataSource.getConnection(); Statement s = c.createStatement()) {
            s.executeUpdate("ALTER TABLE image.generation_job ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE");
            s.executeUpdate("ALTER TABLE image.generation_job ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMP");
            // 回填 last_access_at = create_time；既有 last_access_at 的行不动
            int updated = s.executeUpdate("UPDATE image.generation_job SET last_access_at = create_time WHERE last_access_at IS NULL");
            s.executeUpdate("CREATE INDEX IF NOT EXISTS idx_generation_job_last_access ON image.generation_job (last_access_at) WHERE deleted = 0");

            // 诊断：打一下当前 generation_job 上 saved/last_access_at 到底存不存在
            try (ResultSet rs = s.executeQuery(
                    "SELECT column_name FROM information_schema.columns " +
                    "WHERE table_schema='image' AND table_name='generation_job' " +
                    "AND column_name IN ('saved','last_access_at') ORDER BY column_name")) {
                StringBuilder cols = new StringBuilder();
                while (rs.next()) { if (cols.length() > 0) cols.append(','); cols.append(rs.getString(1)); }
                log.info("[Flyway] ensureColumns: backfilled {} rows; image.generation_job has columns=[{}]", updated, cols);
            }
        } catch (Exception e) {
            // 不吞异常——Hibernate schema-validation 随后肯定失败，早报更清晰
            throw new IllegalStateException("[Flyway] ensureColumns failed: " + e.getMessage(), e);
        }
    }
}
