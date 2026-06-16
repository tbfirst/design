package com.tbfirst.common.oss;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Duration;

/**
 * 对象存储抽象接口。
 * <p>
 * 屏蔽底层存储差异，业务代码只依赖此接口。实现由各服务选择：
 * 本地落盘 {@link com.tbfirst.common.oss.impl.LocalStorageService} / MinIO / 云 OSS（GCS、Aliyun OSS 等）。
 * </p>
 *
 * <h2>v3 重构（S1）：assetKey 与 URL 分离</h2>
 * <ul>
 *   <li>{@link #save} 返回 <b>assetKey</b>（形如 {@code "image/phase1/uuid.png"}），不带任何 URL 前缀。</li>
 *   <li>读/删 接口均以 assetKey 为入参（单参形式）。</li>
 *   <li>响应组装阶段调 {@link #resolveUrl(String)} 把 key 转成前端可消费的 URL。</li>
 * </ul>
 * <p>历史调用方传入带 {@code /static/} 前缀的字符串时，所有方法都应在入口防御性 strip，避免调用方零散迁移期间踩坑。</p>
 *
 * @author tbfirst
 */
public interface StorageService {

    /**
     * 保存对象，返回 assetKey。
     *
     * @param bucket      逻辑桶/key 前缀（例如 {@code image/phase1} / {@code image/brand-model}）
     * @param filename    文件名（含扩展名）
     * @param contentType MIME（例如 {@code image/png}；本地实现忽略，云实现写入 metadata）
     * @param bytes       字节内容
     * @return assetKey，形如 {@code "<bucket>/<filename>"}，<b>不含</b> {@code /static/} 前缀
     * @throws IllegalStateException 写入失败
     */
    String save(String bucket, String filename, String contentType, byte[] bytes);

    /**
     * 根据 assetKey 读取字节。
     *
     * @param assetKey 资源 key（形如 {@code "image/phase1/uuid.png"}）；
     *                 兼容历史 {@code /static/...} 前缀调用方，实现侧应入口 strip。
     * @return 文件字节内容
     * @throws IllegalStateException 读失败（含对象不存在）
     */
    byte[] read(String assetKey);

    /**
     * 删除对象，幂等。
     *
     * @param assetKey 资源 key（形如 {@code "image/phase1/uuid.png"}）；
     *                 兼容历史 {@code /static/...} 前缀调用方，实现侧应入口 strip。
     * @return true = 删除成功；false = 对象本就不存在
     * @throws IllegalStateException 路径越界 / IO 失败 / 权限不足等不可恢复错误
     */
    boolean delete(String assetKey);

    /**
     * 把 assetKey 转为前端可消费的 URL。
     * <ul>
     *   <li>本地实现：返回 {@code "/static/<assetKey>"}（由 Gateway / StaticResourceConfig 透传）。</li>
     *   <li>GCS/OSS 实现：按 url-mode 返回 public URL / 预签名 URL / CDN URL。</li>
     * </ul>
     * <p>实现侧约定：</p>
     * <ul>
     *   <li>入参为 {@code null} / 空白 → 返回原值（不抛）。</li>
     *   <li>入参已经是 {@code http://} / {@code https://} / {@code data:} 开头 → 透传（不二次包装），便于上游 pipeline 中混合外链。</li>
     *   <li>入参带 {@code /static/} 前缀 → strip 后再处理（应对方案 § 10.2 坑 3 的漏迁场景）。</li>
     * </ul>
     *
     * @param assetKey 资源 key
     * @return 完整 URL（或入参直通）
     */
    String resolveUrl(String assetKey);

    /**
     * 带 TTL 的 URL 解析（仅云实现使用）。
     * 默认实现忽略 TTL 退化为 {@link #resolveUrl(String)}，本地实现继承默认即可。
     *
     * @param assetKey 资源 key
     * @param ttl      预签名 URL 有效期；本地实现忽略
     * @return 完整 URL
     */
    default String resolveUrl(String assetKey, Duration ttl) {
        return resolveUrl(assetKey);
    }

    /**
     * 以流的方式读取对象，避免全量缓冲进内存。
     * 默认实现退化为 {@link #read}（兼容未覆盖的旧实现）；云存储实现应覆盖此方法返回真正的网络流。
     * <p><b>调用方须在 try-with-resources 中关闭返回的流。</b></p>
     *
     * @param assetKey 资源 key（形如 {@code "image/phase1/uuid.png"}）
     * @return 可读流
     * @throws IllegalStateException 读失败（含对象不存在）
     */
    default InputStream readStream(String assetKey) {
        return new ByteArrayInputStream(read(assetKey));
    }
}
