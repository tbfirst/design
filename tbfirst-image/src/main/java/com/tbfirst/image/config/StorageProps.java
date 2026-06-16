package com.tbfirst.image.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 存储后端配置。
 *
 * <p>设计动机：v3 起 tbfirst-image 引入云存储抽象（GCS / 阿里云 OSS / MinIO），
 * 通过 {@code app.storage.provider=local|gcs|...} 在启动时挑选实现，零代码切换。</p>
 *
 * <p><b>放在 tbfirst-image 而非 common-oss 的原因</b>：
 * common-oss 的设计约束是「纯 Java 抽象，不引入 spring-boot-starter」（见该模块 pom.xml 注释）。
 * {@code @ConfigurationProperties} 强依赖 Spring Boot，故配置类放在 tbfirst-image 业务模块内即可；
 * S2 引入 GCS 实现时其构造器接收纯 POJO 而非这个 Spring-bound 类，common-oss 保持纯净。</p>
 *
 * <p>对应 application.yml 配置块：</p>
 * <pre>
 * app:
 *   storage:
 *     provider: local              # local | gcs | aliyun (S2+)
 *     local:
 *       path: /app/uploads/image
 *     gcs:
 *       project-id: tbfirst-prod
 *       bucket: tbfirst-bucket-01
 *       credentials-location:      # 留空走 ADC（推荐）
 *       url-mode: presigned        # public | presigned | cdn
 *       signed-url-ttl: PT15M
 *       cdn-domain: cdn.example.com
 * </pre>
 *
 * @author tbfirst
 */
@Data
@ConfigurationProperties("app.storage")
public class StorageProps {

    /** 存储后端，目前支持 {@code local}（默认）；{@code gcs} 等待 S2 实现 */
    private String provider = "local";

    private final Local local = new Local();

    private final Gcs gcs = new Gcs();

    /** 本地磁盘后端配置 */
    @Data
    public static class Local {
        /** 存储根目录绝对路径，容器部署通常挂 {@code /app/uploads} */
        private String path;
    }

    /**
     * GCS 后端配置（v3 S1 仅声明，未启用；S2 实施时 {@code provider=gcs} 才装配 Bean）。
     * 详见 {@code cloud_plan.md} § 6.3 配置模型与 § 5.2 认证策略。
     */
    @Data
    public static class Gcs {
        /** GCP 项目 ID，例如 {@code tbfirst-prod} */
        private String projectId;

        /** 物理桶名（全 GCP 唯一），例如 {@code tbfirst-bucket-01} */
        private String bucket;

        /**
         * Service Account JSON 路径；
         * 留空时 SDK 走 ADC（{@code GOOGLE_APPLICATION_CREDENTIALS} 环境变量 / gcloud login / GKE WIF）。
         */
        private String credentialsLocation;

        /** URL 模式：{@code public} 公开桶 / {@code presigned} V4 签名 / {@code cdn} Cloud CDN */
        private String urlMode = "presigned";

        /** 预签名 URL 有效期，默认 15 分钟 */
        private Duration signedUrlTtl = Duration.ofMinutes(15);

        /** Cloud CDN 自定义域名（仅 {@code url-mode=cdn} 时使用） */
        private String cdnDomain;

        /** 反代模式配置（仅 {@code url-mode=proxy} 时使用），见 .ralph/specs/gcs-proxy.md */
        private final Proxy proxy = new Proxy();

        /** 反代后端配置：员工浏览器经迷你主机 {@code /img/**} 反代访问 GCS（不直发 GCS URL）。 */
        @Data
        public static class Proxy {
            /** 反代根 URL，形如 {@code https://yourdomain.com}，不带尾 / */
            private String baseUrl;
        }
    }
}
