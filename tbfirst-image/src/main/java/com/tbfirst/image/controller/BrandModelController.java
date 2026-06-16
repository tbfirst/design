package com.tbfirst.image.controller;

import com.tbfirst.common.core.response.R;
import com.tbfirst.image.dto.BrandModelDtos;
import com.tbfirst.image.service.BrandModelService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 品牌模特库 REST 入口（{@code /api/image/models}）—— 单组制（errorConclude #38）。
 *
 * 架构角色：
 *  - 权限由 {@link BrandModelService} 按 scope + 角色 + 上传者判断（2026-04-22 permissions
 *    体系已完全下线，所有授权退回 Service 层集中判定）。
 *  - GET 列表强制区分 scope=personal / group（默认 personal）
 *  - POST 上传 body 沿用 V4 的 dataUri；scope 由 query 传入
 *  - DELETE / PUT 的权限由 Service 按 uploader-or-leader 规则内部校验
 *
 * 使用场景：
 *  - Phase1 前端切换个人 / 组 scope → 分别调本控制器相同路径 + 不同 scope 参数
 *  - 其他微服务（modellink / adimage 等）以后可以通过内网 Feign 路径另外暴露，不走此 Controller
 */
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/image/models")
public class BrandModelController {

    private final BrandModelService service;

    /**
     * 列出模特。
     *
     * @param scope personal（默认）| group
     * @return 对应 scope 下未软删记录（组 scope 必须在组内，否则 403）
     */
    @GetMapping
    public R<List<BrandModelDtos.BrandModelResponse>> list(
            @RequestParam(value = "scope", defaultValue = "personal") String scope) {
        return R.ok(service.list(scope));
    }

    /**
     * 上传新模特。权限由 Service 按 scope + 角色 + 容量判断：
     *  - personal: 5（USER）/ 50（ADMIN） 容量
     *  - group:    30 容量；必须是该组成员
     */
    @PostMapping
    public R<BrandModelDtos.BrandModelResponse> upload(
            @Valid @RequestBody BrandModelDtos.UploadRequest req,
            @RequestParam(value = "scope", defaultValue = "personal") String scope) {
        return R.ok(service.upload(req, scope));
    }

    /**
     * 重命名模特。权限：个人库仅上传者；组库 uploader 或 leader。
     * todo 预留接口，Phase1 前端不调用，后续根据需要再完善请求参数（目前仅 name，后续可能增加 description 等）。
     */
    @PutMapping("/{id}")
    public R<BrandModelDtos.BrandModelResponse> rename(@PathVariable Long id,
                                                       @Valid @RequestBody BrandModelDtos.RenameRequest req) {
        return R.ok(service.rename(id, req.getName()));
    }

    /**
     * 软删除模特。权限：个人库仅上传者；组库 uploader 或 leader；ADMIN 全局。
     */
    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return R.ok();
    }

    // ============================================================
    // 一级管理员：全站模特总览（超级视图）
    // ============================================================

    /**
     * admin 专用：列出全部模特（不受 group / user 隔离）。
     *
     * @param scope   all | personal | group
     * @param userId  可选按上传者过滤
     * @param groupId 可选按组过滤
     */
    @GetMapping("/admin/all")
    public R<List<BrandModelDtos.BrandModelResponse>> adminListAll(
            @RequestParam(value = "scope", defaultValue = "all") String scope,
            @RequestParam(value = "userId", required = false) Long userId,
            @RequestParam(value = "groupId", required = false) Long groupId) {
        return R.ok(service.listAllForAdmin(scope, userId, groupId));
    }
}
