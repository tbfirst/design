package com.tbfirst.common.oss.impl;

import com.tbfirst.common.oss.StorageService;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 本地磁盘存储实现，开发/小规模部署默认。
 * <p>
 * 文件按 {@code <root>/<bucket>/<filename>} 目录结构落盘；URL 通过 {@code /static/**}
 * 静态资源映射暴露（详见 {@code StaticResourceConfig}）。生产环境应切换为 GCS / 阿里云 OSS / MinIO，
 * 以便多实例共享存储 + 享受 CDN 加速。
 * </p>
 *
 * <h2>v3 重构（S1）行为变化</h2>
 * <ul>
 *   <li>{@link #save} 返回值由 {@code "/static/<bucket>/<filename>"} 改为 <b>无前缀的 assetKey</b>
 *       {@code "<bucket>/<filename>"}，与 GCS/OSS 实现保持语义一致。</li>
 *   <li>{@link #read}、{@link #delete} 改为单参 assetKey 形式。</li>
 *   <li>新增 {@link #resolveUrl} 把 key 转 URL，等价于 v2 老行为。</li>
 *   <li>所有入参支持 {@code /static/} 前导前缀 strip（防御漏迁）和 http/https/data 直通。</li>
 * </ul>
 *
 * @author tbfirst
 */
@Slf4j
public class LocalStorageService implements StorageService {

    private static final String STATIC_PREFIX = "/static/";

    /** 存储根目录绝对路径 */
    private final Path root;

    /**
     * 构造时自动创建根目录。
     *
     * @param root 存储根目录（相对/绝对皆可，内部会转换为绝对路径）
     */
    public LocalStorageService(String root) {
        this.root = Paths.get(root).toAbsolutePath();
        try {
            Files.createDirectories(this.root);
        } catch (IOException e) {
            // 启动期失败直接中断，避免运行后才发现无法写入
            throw new IllegalStateException("create storage root failed: " + this.root, e);
        }
        // 启动 banner（与 GCS 实现对称）—— 让运维一眼看出当前 StorageService 走哪条实现。
        log.info("==================================================");
        log.info("  Local Storage initialized");
        log.info("  root          = {}", this.root);
        log.info("  provider      = local  (set STORAGE_PROVIDER=gcs to switch)");
        log.info("==================================================");
    }

    /**
     * 保存文件并返回 assetKey。
     *
     * @param bucket      逻辑桶/key 前缀（例如 {@code image/phase1}）
     * @param filename    文件名
     * @param contentType MIME（本地实现未使用，预留给云实现写 metadata）
     * @param bytes       字节内容
     * @return assetKey，形如 {@code "<bucket>/<filename>"}
     * @throws IllegalStateException IO 失败
     */
    @Override
    public String save(String bucket, String filename, String contentType, byte[] bytes) {
        try {
            Path dir = root.resolve(bucket);
            Files.createDirectories(dir);
            Path file = dir.resolve(filename);
            Files.write(file, bytes);
            return bucket + "/" + filename;
        } catch (IOException e) {
            throw new IllegalStateException("save file failed", e);
        }
    }

    /**
     * 根据 assetKey 读取字节内容。
     *
     * @param assetKey 资源 key（形如 {@code "image/phase1/uuid.png"}）；
     *                 兼容 {@code "/static/..."} 前缀写法
     * @return 文件字节
     * @throws IllegalStateException IO 失败（含文件不存在）
     */
    @Override
    public byte[] read(String assetKey) {
        String key = stripStaticPrefix(assetKey);
        if (key == null || key.isBlank()) {
            throw new IllegalStateException("read refused: blank assetKey");
        }
        Path target = root.resolve(key).normalize();
        if (!target.startsWith(root)) {
            throw new IllegalStateException("read refused: path escapes storage root, key=" + assetKey);
        }
        try {
            return Files.readAllBytes(target);
        } catch (IOException e) {
            throw new IllegalStateException("read file failed: " + target, e);
        }
    }

    /**
     * 按 assetKey 删除磁盘文件，幂等。
     * <p>
     * 防御：解析后的绝对路径必须仍在 {@link #root} 子树内，拒绝越界（避免 "../" 注入删到业务目录之外）。
     * </p>
     *
     * @param assetKey 资源 key（兼容 {@code "/static/..."} 前缀）
     * @return true = 文件存在且已删；false = 文件本就不存在 / 入参空
     * @throws IllegalStateException 路径越界 / IO 失败
     */
    @Override
    public boolean delete(String assetKey) {
        String key = stripStaticPrefix(assetKey);
        if (key == null || key.isBlank()) return false;
        Path target = root.resolve(key).normalize();
        // 防越界：normalize 之后还必须是 root 的后裔
        if (!target.startsWith(root)) {
            throw new IllegalStateException("delete refused: path escapes storage root, key=" + assetKey);
        }
        try {
            return Files.deleteIfExists(target);
        } catch (IOException e) {
            throw new IllegalStateException("delete file failed: " + target, e);
        }
    }

    @Override
    public InputStream readStream(String assetKey) {
        String key = stripStaticPrefix(assetKey);
        if (key == null || key.isBlank()) {
            throw new IllegalStateException("readStream refused: blank assetKey");
        }
        Path target = root.resolve(key).normalize();
        if (!target.startsWith(root)) {
            throw new IllegalStateException("readStream refused: path escapes storage root, key=" + assetKey);
        }
        try {
            return Files.newInputStream(target);
        } catch (IOException e) {
            throw new IllegalStateException("readStream failed: " + target, e);
        }
    }

    /**
     * 把 assetKey 包成 {@code /static/<key>} 形式 URL，供前端 {@code <img src>} 直接消费。
     *
     * <p>对历史/混合输入做透传：</p>
     * <ul>
     *   <li>{@code null} / 空白：返回原值。</li>
     *   <li>已是 {@code http://} / {@code https://} / {@code data:} 前缀：直通，不二次包装。</li>
     *   <li>已带 {@code /static/} 前缀：直通（保留语义），不重复拼。</li>
     * </ul>
     */
    @Override
    public String resolveUrl(String assetKey) {
        if (assetKey == null || assetKey.isBlank()) return assetKey;
        if (assetKey.startsWith("http://") || assetKey.startsWith("https://") || assetKey.startsWith("data:")) {
            return assetKey;
        }
        if (assetKey.startsWith(STATIC_PREFIX)) {
            return assetKey;
        }
        return STATIC_PREFIX + assetKey;
    }

    /**
     * 入口防御：剥离前导 {@code /static/} 前缀（应对 cloud_plan.md § 10.2 坑 3 漏迁场景）。
     */
    private static String stripStaticPrefix(String assetKey) {
        if (assetKey == null) return null;
        return assetKey.startsWith(STATIC_PREFIX) ? assetKey.substring(STATIC_PREFIX.length()) : assetKey;
    }
}
