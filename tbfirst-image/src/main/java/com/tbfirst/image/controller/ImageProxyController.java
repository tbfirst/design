package com.tbfirst.image.controller;

import com.tbfirst.common.oss.StorageService;
import com.tbfirst.image.service.AuditLogService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.io.PushbackInputStream;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.NoSuchFileException;
import java.util.Arrays;

/**
 * GCS 反代端点 —— 浏览器经此读取图片字节，避免直接暴露 GCS 域名。
 *
 * <p>路由约定：</p>
 * <ul>
 *   <li>对外：{@code GET https://yourdomain.com/img/{key}} —— Cloudflare Tunnel → gateway → 本端点</li>
 *   <li>Gateway 已校 JWT，下游不重新校验（架构红线 #1，见 .ralph/specs/gcs-proxy.md）</li>
 *   <li>{@code key} 含 {@code /}，无法走 {@code @PathVariable}，从 {@code requestURI} 截取</li>
 * </ul>
 *
 * <p>响应矩阵：</p>
 * <ul>
 *   <li>200 + {@code image/*} + {@code Cache-Control: public, max-age=86400, immutable}：流式传输（显示路径）</li>
 *   <li>200 + {@code Content-Disposition: attachment} + {@code Cache-Control: private, no-store}：流式传输（下载路径）</li>
 *   <li>404：key 在底层不存在（不写 audit，避免噪音）</li>
 *   <li>502：底层读失败（网络 / 凭据 / 限流）—— 写 audit + log warn</li>
 * </ul>
 *
 * @see com.tbfirst.common.oss.impl.GoogleCloudStorageService
 * @see com.tbfirst.image.config.StorageProps
 */
@Slf4j
@RestController
@RequiredArgsConstructor
public class ImageProxyController {

    private static final String IMG_PREFIX = "/img/";

    private final StorageService storageService;
    private final AuditLogService auditLogService;

    @GetMapping("/img/**")
    public void proxy(
            HttpServletRequest request,
            HttpServletResponse response,
            @RequestParam(value = "download", required = false) String download
    ) throws IOException {
        String key = extractKey(request.getRequestURI());
        if (key == null || key.isBlank()) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        if (download != null) {
            serveDownload(key, download, response);
        } else {
            serveDisplay(key, response);
        }
    }

    /**
     * 显示路径：流式传输，不缓冲全量字节。
     * Cache-Control public+immutable：UUID key 天然不可变，Cloudflare 可在边缘缓存，重复请求不打后端。
     */
    private void serveDisplay(String key, HttpServletResponse response) throws IOException {
        InputStream stream;
        try {
            stream = storageService.readStream(key);
        } catch (IllegalStateException e) {
            respondError(e, key, response);
            return;
        } catch (Exception e) {
            respondUnexpected(e, key, response);
            return;
        }
        response.setContentType(contentTypeOf(key));
        response.setHeader("Cache-Control", "public, max-age=86400, immutable");
        response.setHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        try (InputStream in = stream) {
            in.transferTo(response.getOutputStream());
        } catch (IOException e) {
            log.warn("[ImageProxy] display stream transfer failed: key={}, err={}", key, e.getMessage());
        }
    }

    /**
     * 下载路径：用 PushbackInputStream 嗅探头 12 字节做魔数 MIME 判定，再流式传输剩余字节。
     * V5.XI-3.7：覆盖 GCS 历史脏数据（名 .jpg、字节 PNG），保证 Content-Disposition 文件名扩展名正确。
     * 下载不走 CDN 缓存（private, no-store），确保每次拿到实际字节。
     */
    private void serveDownload(String key, String download, HttpServletResponse response) throws IOException {
        InputStream raw;
        try {
            raw = storageService.readStream(key);
        } catch (IllegalStateException e) {
            respondError(e, key, response);
            return;
        } catch (Exception e) {
            respondUnexpected(e, key, response);
            return;
        }
        try (PushbackInputStream pis = new PushbackInputStream(raw, 12)) {
            byte[] header = new byte[12];
            int n = pis.read(header, 0, header.length);
            if (n > 0) pis.unread(header, 0, n);

            String detectedMime = n > 0 ? detectImageMimeFromBytes(Arrays.copyOf(header, n)) : null;
            String contentType = detectedMime != null ? detectedMime : contentTypeOf(key);

            String rawName = download.isBlank() ? defaultFilename(key) : download;
            String safeName = sanitizeFilename(rawName);
            if (detectedMime != null) safeName = correctFilenameExtension(safeName, detectedMime);
            String encodedName = URLEncoder.encode(safeName, StandardCharsets.UTF_8).replace("+", "%20");

            response.setContentType(contentType);
            response.setHeader("Cache-Control", "private, no-store");
            response.setHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + safeName + "\"; filename*=UTF-8''" + encodedName);
            pis.transferTo(response.getOutputStream());
        } catch (IOException e) {
            log.warn("[ImageProxy] download stream transfer failed: key={}, err={}", key, e.getMessage());
        }
    }

    private void respondError(IllegalStateException e, String key, HttpServletResponse response) throws IOException {
        if (isNotFound(e)) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        // V5.XV.3: 凭据/权限类错误单独标记，运维查 audit 时一眼区分"上游 5xx"vs"GCS 鉴权失效"
        String code = isGcsAuthFailure(e) ? "GCS_AUTH" : "GCS_UPSTREAM";
        log.warn("[ImageProxy] read failed: key={}, code={}, err={}", key, code, e.getMessage());
        auditLogService.log("PROXY_GCS_FAIL", "code=" + code + ", key=" + key + ", err=" + e.getMessage(), null);
        response.setStatus(HttpServletResponse.SC_BAD_GATEWAY);
    }

    private void respondUnexpected(Exception e, String key, HttpServletResponse response) throws IOException {
        log.warn("[ImageProxy] unexpected error: key={}, err={}", key, e.getMessage());
        auditLogService.log("PROXY_GCS_FAIL", "code=UNEXPECTED, key=" + key + ", err=" + e.getMessage(), null);
        response.setStatus(HttpServletResponse.SC_BAD_GATEWAY);
    }

    /** 从 GCS key 末段截 basename，失败时回退 "image"。 */
    static String defaultFilename(String key) {
        if (key == null || key.isBlank()) return "image";
        int slash = key.lastIndexOf('/');
        String name = slash >= 0 && slash < key.length() - 1 ? key.substring(slash + 1) : key;
        return name.isBlank() ? "image" : name;
    }

    /** 替换 Windows/Unix 不合法的文件名字符，保留扩展名。 */
    static String sanitizeFilename(String name) {
        if (name == null || name.isBlank()) return "image";
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        return cleaned.isEmpty() ? "image" : cleaned;
    }

    /**
     * 从 {@code /img/<key>} 截 key 段并 URL 解码（兼容中文 / 空格）。
     * V5.XV.3: 防御性剥除 {@code ?} 之后的 query string ——
     * {@code HttpServletRequest.getRequestURI()} 通常已不含 query，但若上游 gateway/代理
     * 不规范、把原始 URL 整段传过来，扎实做"双保险"避免把 {@code ?download=...} 误当成 key 一部分。
     */
    private static String extractKey(String uri) {
        if (uri == null || !uri.startsWith(IMG_PREFIX)) return null;
        String raw = uri.substring(IMG_PREFIX.length());
        int qPos = raw.indexOf('?');
        if (qPos >= 0) raw = raw.substring(0, qPos);
        return URLDecoder.decode(raw, StandardCharsets.UTF_8);
    }

    /**
     * 按扩展名推断 Content-Type。
     * 未知扩展名退化为 {@code application/octet-stream}（浏览器会下载而非内联渲染，符合最小信任）。
     */
    static String contentTypeOf(String key) {
        int dot = key.lastIndexOf('.');
        if (dot < 0 || dot == key.length() - 1) return MediaType.APPLICATION_OCTET_STREAM_VALUE;
        String ext = key.substring(dot + 1).toLowerCase();
        return switch (ext) {
            case "png" -> MediaType.IMAGE_PNG_VALUE;
            case "jpg", "jpeg" -> MediaType.IMAGE_JPEG_VALUE;
            case "webp" -> "image/webp";
            case "gif" -> MediaType.IMAGE_GIF_VALUE;
            default -> MediaType.APPLICATION_OCTET_STREAM_VALUE;
        };
    }

    /**
     * 区分 404（对象不存在）和 502（其它错误）。
     * 底层 StorageService 接口约定都用 IllegalStateException，"not found" 走消息匹配；
     * LocalStorageService 走 IOException → cause 是 NoSuchFileException。
     */
    private static boolean isNotFound(IllegalStateException e) {
        String msg = e.getMessage();
        if (msg != null && msg.toLowerCase().contains("not found")) return true;
        Throwable cause = e.getCause();
        return cause instanceof NoSuchFileException;
    }

    /**
     * V5.XV.3: 识别 GCS 鉴权类失败（凭证过期、权限不足）。
     * GCS Java SDK 抛 StorageException 时消息含 "forbidden" / "unauthenticated" / "permission";
     * 服务账号 JSON key 失效则可能含 "credentials" 字样。命中则 audit code=GCS_AUTH。
     */
    private static boolean isGcsAuthFailure(IllegalStateException e) {
        String msg = e.getMessage();
        if (msg == null) return false;
        String lower = msg.toLowerCase();
        return lower.contains("forbidden")
                || lower.contains("unauthenticated")
                || lower.contains("permission")
                || lower.contains("credentials");
    }

    /**
     * V5.XI-3.7：字节魔数判定真实图片 MIME。
     * 覆盖 GCS 历史脏数据 —— ImageGenerateServiceImpl.persistImages V5.XI-3.5 之前依
     * 据 Gemini 上游 data URI 声明的 mime 推断 ext，可能把 PNG 字节命名为 .jpg；
     * 此处兜底，让响应 Content-Type 与字节真实格式一致。
     */
    static String detectImageMimeFromBytes(byte[] bytes) {
        if (bytes == null || bytes.length < 4) return null;
        // PNG: 89 50 4E 47
        if ((bytes[0] & 0xff) == 0x89 && (bytes[1] & 0xff) == 0x50
                && (bytes[2] & 0xff) == 0x4e && (bytes[3] & 0xff) == 0x47) return MediaType.IMAGE_PNG_VALUE;
        // JPEG: FF D8 FF
        if ((bytes[0] & 0xff) == 0xff && (bytes[1] & 0xff) == 0xd8 && (bytes[2] & 0xff) == 0xff)
            return MediaType.IMAGE_JPEG_VALUE;
        // GIF: 47 49 46 38
        if ((bytes[0] & 0xff) == 0x47 && (bytes[1] & 0xff) == 0x49
                && (bytes[2] & 0xff) == 0x46 && (bytes[3] & 0xff) == 0x38) return MediaType.IMAGE_GIF_VALUE;
        // WebP: RIFF....WEBP
        if (bytes.length >= 12
                && (bytes[0] & 0xff) == 0x52 && (bytes[1] & 0xff) == 0x49
                && (bytes[2] & 0xff) == 0x46 && (bytes[3] & 0xff) == 0x46
                && (bytes[8] & 0xff) == 0x57 && (bytes[9] & 0xff) == 0x45
                && (bytes[10] & 0xff) == 0x42 && (bytes[11] & 0xff) == 0x50) return "image/webp";
        // BMP: 42 4D
        if ((bytes[0] & 0xff) == 0x42 && (bytes[1] & 0xff) == 0x4d) return "image/bmp";
        return null;
    }

    /**
     * V5.XI-3.7：根据魔数检测出的真实 MIME 校正文件名扩展名。
     * 与前端 saveBlobAs.correctFilenameForMime 对称：让响应头 Content-Disposition
     * 给浏览器的 filename 与真实字节匹配，避免用户下载到本地后扩展名错位无法预览。
     */
    static String correctFilenameExtension(String filename, String mime) {
        if (filename == null || filename.isBlank() || mime == null) return filename;
        String targetExt;
        switch (mime.toLowerCase()) {
            case "image/png" -> targetExt = ".png";
            case "image/jpeg" -> targetExt = ".jpg";
            case "image/gif" -> targetExt = ".gif";
            case "image/webp" -> targetExt = ".webp";
            case "image/bmp" -> targetExt = ".bmp";
            default -> { return filename; }
        }
        String lower = filename.toLowerCase();
        // jpg/jpeg 都算 jpeg 已匹配
        if (targetExt.equals(".jpg") && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) return filename;
        if (lower.endsWith(targetExt)) return filename;
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot < filename.length() - 6) {
            return filename + targetExt;
        }
        return filename.substring(0, dot) + targetExt;
    }
}
