package com.tbfirst.common.oss.impl;

import com.google.auth.ServiceAccountSigner;
import com.google.auth.oauth2.GoogleCredentials;
import com.google.auth.oauth2.ServiceAccountCredentials;
import com.google.cloud.storage.Blob;
import com.google.cloud.storage.BlobId;
import com.google.cloud.storage.BlobInfo;
import com.google.cloud.storage.HttpMethod;
import com.google.cloud.storage.Storage;
import com.google.cloud.storage.StorageException;
import com.google.cloud.storage.StorageOptions;
import com.tbfirst.common.oss.StorageService;
import lombok.extern.slf4j.Slf4j;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.channels.Channels;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Google Cloud Storage 后端实现。
 *
 * <h2>v3 S2 设计要点</h2>
 * <ul>
 *   <li>构造器接收纯 POJO（{@link Config}），不依赖 Spring Boot 的 {@code @ConfigurationProperties}，
 *       从而 {@code tbfirst-common-oss} 模块保持「纯 Java 抽象 + 不引入 spring-boot-starter」的原则。</li>
 *   <li>{@link #save} 返回纯 assetKey（形如 {@code "<prefix>/<filename>"}），与 {@link LocalStorageService} 行为一致。</li>
 *   <li>{@link #resolveUrl} 按 {@link UrlMode} 三态：
 *       {@code PUBLIC} 直接拼公开桶 URL；{@code PRESIGNED} V4 签名（默认 TTL 来自 {@link Config#defaultTtl}）；
 *       {@code CDN} 拼 Cloud CDN 自定义域名 URL。CDN Signed URL/Cookie 是 LB 层概念，由 GCP Console 配置，
 *       此实现不参与（参见 {@code cloud_plan.md} § 5.5）。</li>
 *   <li>所有 assetKey 入参在入口 strip 前导 {@code /static/}，应对 {@code cloud_plan.md} § 10.2 坑 3 漏迁场景。</li>
 * </ul>
 *
 * <h2>认证发现顺序（ADC）</h2>
 * SDK 走默认 ADC：{@code GOOGLE_APPLICATION_CREDENTIALS} → gcloud login → GKE Metadata Server → WIF。
 * 本项目 docker-compose 部署只走第一条：{@code /secrets/gcs-sa.json} 由容器只读挂载。SA JSON 自带 {@code private_key}，
 * 直接 {@link Storage#signUrl} 即可签名，不触发 {@code ImpersonatedCredentials} 分支（cloud_plan.md § 5.2）。
 *
 * @author tbfirst
 */
@Slf4j
public class GoogleCloudStorageService implements StorageService {

    private static final String STATIC_PREFIX = "/static/";

    /** Cache-Control 默认值：私有图片用 no-store；公开图片建议 1 年 immutable，由调用方覆盖 */
    private static final String DEFAULT_CACHE_CONTROL = "private, no-store";

    /** GCS 公开桶 URL 的固定前缀（仅 {@link UrlMode#PUBLIC} 场景使用） */
    private static final String PUBLIC_URL_PREFIX = "https://storage.googleapis.com/";

    private final Storage storage;
    /** 仅 {@link UrlMode#PRESIGNED} 需要；当 ADC 拿到的凭据本身就实现 ServiceAccountSigner 时可为 null（SDK 自动签） */
    private final ServiceAccountSigner signer;
    private final String bucket;
    private final UrlMode urlMode;
    private final Duration defaultTtl;
    /** 仅 {@link UrlMode#CDN} 需要；形如 {@code cdn.example.com}，不带 scheme */
    private final String cdnDomain;
    /** 仅 {@link UrlMode#PROXY} 需要；形如 {@code https://yourdomain.com}，不带尾 / */
    private final String proxyBaseUrl;

    public enum UrlMode { PUBLIC, PRESIGNED, CDN, PROXY }

    /**
     * 构造 GCS 服务。
     *
     * @param config 纯 POJO 配置（避免 Spring Boot 强耦合，由 tbfirst-image 的 StorageConfig 适配 StorageProps.Gcs 转入）
     */
    public GoogleCloudStorageService(Config config) {
        this.bucket = requireNonBlank(config.bucket, "config.bucket");
        this.urlMode = UrlMode.valueOf(requireNonBlank(config.urlMode, "config.urlMode").toUpperCase());
        this.defaultTtl = config.defaultTtl == null ? Duration.ofMinutes(15) : config.defaultTtl;
        this.cdnDomain = config.cdnDomain;
        this.proxyBaseUrl = config.proxyBaseUrl;

        this.storage = StorageOptions.newBuilder()
                .setProjectId(config.projectId)
                .setCredentials(loadCredentials(config.credentialsLocation))
                .build()
                .getService();

        // 显式准备一个 signer：优先从 credentialsLocation 加载（拿得到 private_key）；
        // 失败则尝试把 ADC 凭据 cast 成 ServiceAccountSigner（GKE WIF impersonated 场景下自动可用）。
        this.signer = resolveSigner(config.credentialsLocation);

        if (this.urlMode == UrlMode.CDN && (this.cdnDomain == null || this.cdnDomain.isBlank())) {
            throw new IllegalStateException("urlMode=CDN requires cdnDomain to be set");
        }
        if (this.urlMode == UrlMode.PROXY && (this.proxyBaseUrl == null || this.proxyBaseUrl.isBlank())) {
            throw new IllegalStateException("PROXY mode requires app.storage.gcs.proxy-base-url");
        }
        if (this.urlMode == UrlMode.PRESIGNED && this.signer == null) {
            log.warn("[GCS] urlMode=PRESIGNED but no ServiceAccountSigner resolved; "
                    + "签名将退化由 SDK 默认尝试。WIF/Metadata 场景请改用 ImpersonatedCredentials。"
                    + "Refer: cloud_plan.md § 5.2.");
        }

        // 启动 banner（cloud_plan.md § 10.2 坑 12）—— 容器起来 3 秒内能发现 SA / 桶 / 模式配错。
        log.info("==================================================");
        log.info("  GCS Storage initialized");
        log.info("  project       = {}", maskNullable(config.projectId));
        log.info("  bucket        = {}", bucket);
        log.info("  url-mode      = {}", urlMode);
        log.info("  signed-ttl    = {}", defaultTtl);
        log.info("  credentials   = {}", maskCredentialsPath(config.credentialsLocation));
        log.info("  signer ready  = {}", signer != null);
        log.info("  cdn-domain    = {}", maskNullable(cdnDomain));
        log.info("  proxy-base-url= {}", maskNullable(proxyBaseUrl));
        log.info("==================================================");
    }

    // ------------------------------------------------------------------------- StorageService 接口

    @Override
    public String save(String prefix, String filename, String contentType, byte[] bytes) {
        String key = prefix + "/" + filename;
        // private 模式下用 no-store 防止中间代理缓存；CDN/PUBLIC 场景调用方可在桶级或 LB 改 Cache-Control。
        BlobInfo info = BlobInfo.newBuilder(BlobId.of(bucket, key))
                .setContentType(contentType)
                .setCacheControl(urlMode == UrlMode.PRESIGNED ? DEFAULT_CACHE_CONTROL
                        : "public, max-age=31536000, immutable")
                .build();
        try {
            // 默认 create(info, bytes) 全量缓冲；> 5MB 大图请走 WriteChannel（cloud_plan.md § 10.2 坑 9）。
            // 当前业务侧最大单帧约 4MB，create 足够。
            storage.create(info, bytes);
        } catch (StorageException e) {
            throw new IllegalStateException("gcs.save failed: bucket=" + bucket + ", key=" + key, e);
        }
        return key;
    }

    @Override
    public byte[] read(String assetKey) {
        String key = stripStaticPrefix(assetKey);
        if (key == null || key.isBlank()) {
            throw new IllegalStateException("read refused: blank assetKey");
        }
        // V5.XVII.J：GCS 偶发 5xx / 网络抖动一次重试，遮蔽国内网络访问 GCS 的尾延迟。
        // read 操作幂等（GCS 强一致 + 不修改对象），重试无副作用。
        // 不重试 404 NOT_FOUND（blob == null）—— 那条直接给上层映射成 HTTP 404，
        // 重试无意义反而拖慢正常的"对象不存在"路径。
        StorageException lastErr = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                Blob blob = storage.get(BlobId.of(bucket, key));
                if (blob == null) {
                    throw new IllegalStateException("gcs.read object not found: " + key);
                }
                return blob.getContent();
            } catch (StorageException e) {
                lastErr = e;
                int code = e.getCode();
                // 'transient' 是 Java 保留字 —— 改名为 isTransient
                boolean isTransient = code >= 500 || code == 408 || code == 429 || code == 0;
                if (!isTransient || attempt == 1) {
                    throw new IllegalStateException("gcs.read failed: bucket=" + bucket + ", key=" + key, e);
                }
                log.warn("[GCS] read transient {} on key={}, retrying once", code, key);
                try {
                    Thread.sleep(500);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("gcs.read interrupted: bucket=" + bucket + ", key=" + key, ie);
                }
            }
        }
        throw new IllegalStateException("gcs.read failed: bucket=" + bucket + ", key=" + key, lastErr);
    }

    @Override
    public InputStream readStream(String assetKey) {
        String key = stripStaticPrefix(assetKey);
        if (key == null || key.isBlank()) {
            throw new IllegalStateException("readStream refused: blank assetKey");
        }
        StorageException lastErr = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                Blob blob = storage.get(BlobId.of(bucket, key));
                if (blob == null) {
                    throw new IllegalStateException("gcs.readStream object not found: " + key);
                }
                return Channels.newInputStream(blob.reader());
            } catch (StorageException e) {
                lastErr = e;
                int code = e.getCode();
                boolean isTransient = code >= 500 || code == 408 || code == 429 || code == 0;
                if (!isTransient || attempt == 1) {
                    throw new IllegalStateException("gcs.readStream failed: bucket=" + bucket + ", key=" + key, e);
                }
                log.warn("[GCS] readStream transient {} on key={}, retrying once", code, key);
                try {
                    Thread.sleep(500);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("gcs.readStream interrupted: key=" + key, ie);
                }
            }
        }
        throw new IllegalStateException("gcs.readStream failed: bucket=" + bucket + ", key=" + key, lastErr);
    }

    @Override
    public boolean delete(String assetKey) {
        String key = stripStaticPrefix(assetKey);
        if (key == null || key.isBlank()) return false;
        try {
            return storage.delete(BlobId.of(bucket, key));
        } catch (StorageException e) {
            throw new IllegalStateException("gcs.delete failed: bucket=" + bucket + ", key=" + key, e);
        }
    }

    @Override
    public String resolveUrl(String assetKey) {
        return resolveUrl(assetKey, defaultTtl);
    }

    @Override
    public String resolveUrl(String assetKey, Duration ttl) {
        if (assetKey == null || assetKey.isBlank()) return assetKey;
        // 透传外链 / data URI（与 LocalStorageService 行为对齐，避免上游 pipeline 混合输入崩坏）
        if (assetKey.startsWith("http://") || assetKey.startsWith("https://") || assetKey.startsWith("data:")) {
            return assetKey;
        }
        String key = stripStaticPrefix(assetKey);
        return switch (urlMode) {
            case PUBLIC -> PUBLIC_URL_PREFIX + bucket + "/" + key;
            case CDN -> "https://" + cdnDomain + "/" + key;
            case PROXY -> proxyBaseUrl + "/img/" + key;
            case PRESIGNED -> signPresignedV4(key, ttl == null ? defaultTtl : ttl);
        };
    }

    // ------------------------------------------------------------------------- internals

    private String signPresignedV4(String key, Duration ttl) {
        try {
            BlobInfo info = BlobInfo.newBuilder(BlobId.of(bucket, key)).build();
            URL url;
            if (signer != null) {
                // 显式 signer 路径（推荐，docker-compose 主路径，SA JSON 直接签）
                url = storage.signUrl(info,
                        ttl.toMinutes(), TimeUnit.MINUTES,
                        Storage.SignUrlOption.httpMethod(HttpMethod.GET),
                        Storage.SignUrlOption.withV4Signature(),
                        Storage.SignUrlOption.signWith(signer));
            } else {
                // 退回 SDK 默认路径：仅当 SDK 拿得到的 credentials 自身就能签（如 ADC 命中 SA JSON）才有效
                url = storage.signUrl(info,
                        ttl.toMinutes(), TimeUnit.MINUTES,
                        Storage.SignUrlOption.httpMethod(HttpMethod.GET),
                        Storage.SignUrlOption.withV4Signature());
            }
            return url.toString();
        } catch (Exception e) {
            throw new IllegalStateException("gcs.signUrl failed: bucket=" + bucket + ", key=" + key
                    + " (排查见 cloud_plan.md § 10.2 坑 12 / § 5.2 V4 签名章节)", e);
        }
    }

    /** 加载凭据：优先用显式 JSON 路径，留空则走 ADC（GOOGLE_APPLICATION_CREDENTIALS / gcloud / Metadata / WIF）。 */
    private static GoogleCredentials loadCredentials(String credentialsLocation) {
        try {
            if (credentialsLocation != null && !credentialsLocation.isBlank()) {
                Path p = Paths.get(credentialsLocation);
                if (!Files.exists(p)) {
                    throw new IllegalStateException("credentialsLocation not found: " + credentialsLocation);
                }
                try (FileInputStream in = new FileInputStream(p.toFile())) {
                    return GoogleCredentials.fromStream(in);
                }
            }
            return GoogleCredentials.getApplicationDefault();
        } catch (IOException e) {
            throw new IllegalStateException("load GCS credentials failed (location=" + credentialsLocation + ")", e);
        }
    }

    /** 解析 signer：必须是 ServiceAccountCredentials 才能本地签（含 private_key）。 */
    private static ServiceAccountSigner resolveSigner(String credentialsLocation) {
        try {
            if (credentialsLocation != null && !credentialsLocation.isBlank()) {
                Path p = Paths.get(credentialsLocation);
                if (Files.exists(p)) {
                    try (FileInputStream in = new FileInputStream(p.toFile())) {
                        return ServiceAccountCredentials.fromStream(in);
                    }
                }
            }
            // ADC 兜底：如果默认凭据本身就实现了 Signer 接口（少见，多数 metadata 场景不实现），直接用
            GoogleCredentials adc = GoogleCredentials.getApplicationDefault();
            if (adc instanceof ServiceAccountSigner s) return s;
            return null;
        } catch (IOException e) {
            log.warn("[GCS] resolveSigner failed (location={}): {}", credentialsLocation, e.getMessage());
            return null;
        }
    }

    private static String stripStaticPrefix(String assetKey) {
        if (assetKey == null) return null;
        return assetKey.startsWith(STATIC_PREFIX) ? assetKey.substring(STATIC_PREFIX.length()) : assetKey;
    }

    private static String requireNonBlank(String v, String name) {
        if (v == null || v.isBlank()) throw new IllegalStateException(name + " must not be blank");
        return v;
    }

    private static String maskNullable(String v) {
        return v == null || v.isBlank() ? "<unset>" : v;
    }

    /** 仅打印「是否加载到」+ 文件名（不含完整路径），避免容器路径泄漏到日志。 */
    private static String maskCredentialsPath(String location) {
        if (location == null || location.isBlank()) return "ADC fallback (env / gcloud / metadata)";
        Path p = Paths.get(location);
        return "loaded (file=" + p.getFileName() + ", exists=" + Files.exists(p) + ")";
    }

    // ------------------------------------------------------------------------- 配置 POJO

    /**
     * GCS 实现配置。tbfirst-image 的 StorageConfig 把 StorageProps.Gcs 字段拷进来（解耦 Spring Boot）。
     */
    public static class Config {
        public String projectId;
        public String bucket;
        /** 留空走 ADC */
        public String credentialsLocation;
        /** {@code public} / {@code presigned} / {@code cdn} */
        public String urlMode = "presigned";
        public Duration defaultTtl = Duration.ofMinutes(15);
        /** 仅 url-mode=cdn 时使用 */
        public String cdnDomain;
        /** 仅 url-mode=proxy 时使用；形如 {@code https://yourdomain.com}，不带尾 / */
        public String proxyBaseUrl;

        /** Builder-ish 链式构造，便于 StorageConfig 一行写出。 */
        public static Config of(String projectId, String bucket, String credentialsLocation,
                                String urlMode, Duration defaultTtl, String cdnDomain) {
            Config c = new Config();
            c.projectId = projectId;
            c.bucket = bucket;
            c.credentialsLocation = credentialsLocation;
            c.urlMode = urlMode;
            c.defaultTtl = defaultTtl;
            c.cdnDomain = cdnDomain;
            return c;
        }

        public String getProxyBaseUrl() { return proxyBaseUrl; }

        public void setProxyBaseUrl(String proxyBaseUrl) { this.proxyBaseUrl = proxyBaseUrl; }
    }

    // ------------------------------------------------------------------------- factory utility（健康检查可选）

    /**
     * 健康探针（可选，由 tbfirst-image 的 HealthIndicator 调用）：拿一个不存在的对象元数据，
     * 401/403 立即暴露认证问题；404 才是正常。Map 返回避免 health 模块依赖 Spring Actuator。
     */
    public Map<String, Object> probe() {
        try {
            storage.get(BlobId.of(bucket, "__healthcheck_does_not_exist__"));
            return Map.of("status", "UP", "bucket", bucket);
        } catch (StorageException e) {
            if (e.getCode() == 404) return Map.of("status", "UP", "bucket", bucket);
            return Map.of("status", "DOWN", "code", e.getCode(), "msg", String.valueOf(e.getMessage()));
        } catch (Exception e) {
            return Map.of("status", "DOWN", "msg", String.valueOf(e.getMessage()));
        }
    }
}
