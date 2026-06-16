package com.tbfirst.image.config;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Paths;

/**
 * 把本地存储根目录挂到 HTTP 的 {@code /static/**} 路径下（仅 provider=local 时生效）。
 *
 * <p>生图/上传完成后存在磁盘上的图片（如 {@code E:/tbfirst/testpicture/image/phase1/xxx.png}），
 * 会通过 Gateway 路由 {@code /static/**} → tbfirst-image → 本配置下发。</p>
 *
 * <p>v3 S1：类级加 {@link ConditionalOnProperty}，仅 {@code app.storage.provider=local}（默认）时装配；
 * provider=gcs 时整类不注册，前端从 GCS 直接拉图，本服务不再做静态文件透传。</p>
 *
 * <p>注意：URI 必须是绝对路径 + {@code file:///} 前缀，{@code addResourceLocations} 不接受相对路径。</p>
 */
@Configuration
@ConditionalOnProperty(name = "app.storage.provider", havingValue = "local", matchIfMissing = true)
@RequiredArgsConstructor
public class StaticResourceConfig implements WebMvcConfigurer {

    private final StorageProps props;

    /**
     * 注册 /static/** 静态资源 handler，指向磁盘上的存储根目录。
     *
     * @param registry Spring MVC 静态资源注册中心
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String path = props.getLocal().getPath();
        if (path == null || path.isBlank()) {
            path = "./data/uploads/image";
        }
        // toUri().toString() → "file:///E:/tbfirst/testpicture/"，Spring 能识别
        String absPath = Paths.get(path).toAbsolutePath().toUri().toString();
        registry.addResourceHandler("/static/**")
                .addResourceLocations(absPath);
    }
}
