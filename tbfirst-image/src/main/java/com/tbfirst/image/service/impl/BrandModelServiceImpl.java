package com.tbfirst.image.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.common.core.exception.BizException;
import com.tbfirst.common.core.response.ErrorCode;
import com.tbfirst.common.datasource.asset.SharedAsset;
import com.tbfirst.common.oss.StorageService;
import com.tbfirst.common.security.context.UserContext;
import com.tbfirst.common.security.context.UserContextHolder;
import com.tbfirst.image.dto.BrandModelDtos;
import com.tbfirst.image.entity.BrandModel;
import com.tbfirst.image.mapper.BrandModelMapper;
import com.tbfirst.image.service.BrandModelService;
import com.tbfirst.image.service.SharedAssetLocalService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * 品牌模特库服务实现。
 *
 * <p><b>职责：</b>{@link BrandModelService} 的唯一实现，围绕 image.brand_model 表
 * 提供"个人库 / 组共享库"两层的 CRUD。</p>
 *
 * <p><b>容量控制：</b></p>
 * <ul>
 *   <li>personal：优先读 UserContext.personalModelCap（来自 JWT claim），
 *       为 null 回落默认值（admin 50 / user 5）；</li>
 *   <li>group：优先读 UserContext.groupModelCap，null 回落默认 30。</li>
 * </ul>
 *
 * <p><b>跨服务集成：</b>每次 upload 成功后会调 {@link SharedAssetLocalService#register}
 * 在 asset.shared_asset 里留影，使得其它服务（如 tbfirst-adimage）可通过同一 assetKey
 * 引用这张图，避免跨服务下载。</p>
 *
 * <p><b>权限边界：</b>loadAndAuthorize 守卫写操作 —— 个人模特只能本人改；
 * 组内模特只能上传者或组长改。ADMIN 角色绕过所有守卫。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BrandModelServiceImpl implements BrandModelService {

    /** 物理存储 key 前缀（GCS / 本地都是这个），统一收敛到 image/ 命名空间下 */
    private static final String STORAGE_PREFIX = "image/brand-model";
    /** asset.shared_asset.bucket 列里的业务分类标签，仅用于跨服务查询分类，与物理路径解耦 */
    private static final String LOGICAL_BUCKET = "brand-model";

    private static final long DEFAULT_PERSONAL_CAP_USER = 5;
    private static final long DEFAULT_PERSONAL_CAP_ADMIN = 50;
    private static final long DEFAULT_GROUP_CAP = 30;

    private final BrandModelMapper mapper;
    private final StorageService storageService;
    private final SharedAssetLocalService sharedAssetService;

    public List<BrandModelDtos.BrandModelResponse> list(String scope) {
        UserContext ctx = requireContext();
        Long userId = ctx.getUserId();
        boolean group = "group".equalsIgnoreCase(scope);

        List<BrandModel> models;
        if (group) {
            Long gid = ctx.getGroupId();
            if (gid == null) {
                throw new BizException(ErrorCode.FORBIDDEN, "尚未加入任何共享组");
            }
            // SQL: SELECT * FROM image.brand_model
            //      WHERE group_id = ? AND deleted = 0 ORDER BY create_time DESC
            models = mapper.selectList(new LambdaQueryWrapper<BrandModel>()
                    .eq(BrandModel::getGroupId, gid)
                    .orderByDesc(BrandModel::getCreateTime));
        } else {
            // SQL: SELECT * FROM image.brand_model
            //      WHERE user_id = ? AND group_id IS NULL AND deleted = 0 ORDER BY create_time DESC
            models = mapper.selectList(new LambdaQueryWrapper<BrandModel>()
                    .eq(BrandModel::getUserId, userId)
                    .isNull(BrandModel::getGroupId)
                    .orderByDesc(BrandModel::getCreateTime));
        }
        return models.stream()
                .map(m -> toResponse(m, storageService.resolveUrl(m.getImageKey())))
                .toList();
    }

    @Transactional
    public BrandModelDtos.BrandModelResponse upload(BrandModelDtos.UploadRequest req, String scope) {
        UserContext ctx = requireContext();
        Long userId = ctx.getUserId();
        boolean group = "group".equalsIgnoreCase(scope);

        Long groupId = null;
        if (group) {
            groupId = ctx.getGroupId();
            if (groupId == null) {
                throw new BizException(ErrorCode.FORBIDDEN, "尚未加入任何共享组，无法向组库上传");
            }
            long cap = ctx.getGroupModelCap() != null ? ctx.getGroupModelCap() : DEFAULT_GROUP_CAP;
            // SQL: SELECT COUNT(*) FROM image.brand_model WHERE group_id = ? AND deleted = 0
            long count = mapper.selectCount(new LambdaQueryWrapper<BrandModel>()
                    .eq(BrandModel::getGroupId, groupId));
            if (count >= cap) {
                throw new BizException(ErrorCode.CONFLICT,
                        String.format("组共享库已满（%d/%d），请先删除后再上传", count, cap));
            }
        } else {
            long cap = ctx.getPersonalModelCap() != null
                    ? ctx.getPersonalModelCap()
                    : (isAdmin(ctx) ? DEFAULT_PERSONAL_CAP_ADMIN : DEFAULT_PERSONAL_CAP_USER);
            // SQL: SELECT COUNT(*) FROM image.brand_model
            //      WHERE user_id = ? AND group_id IS NULL AND deleted = 0
            long count = mapper.selectCount(new LambdaQueryWrapper<BrandModel>()
                    .eq(BrandModel::getUserId, userId)
                    .isNull(BrandModel::getGroupId));
            if (count >= cap) {
                throw new BizException(ErrorCode.CONFLICT,
                        String.format("个人模特库已满（%d/%d），请先删除后再上传", count, cap));
            }
        }

        String dataUri = req.getDataUri();
        int commaIdx = dataUri.indexOf(',');
        if (commaIdx < 0) {
            throw new BizException(ErrorCode.BAD_REQUEST, "invalid dataUri format");
        }
        String meta = dataUri.substring(0, commaIdx);
        String base64Data = dataUri.substring(commaIdx + 1);
        String mimeType = meta.replaceFirst("data:", "").replaceFirst(";base64", "");

        byte[] bytes = Base64.getDecoder().decode(base64Data);
        String ext = mimeType.contains("png") ? ".png"
                : mimeType.contains("jpeg") || mimeType.contains("jpg") ? ".jpg"
                : mimeType.contains("webp") ? ".webp" : ".bin";
        String filename = UUID.randomUUID() + ext;

        // v3 起 save() 直接返回 assetKey（形如 "image/brand-model/uuid.png"），不再需要手动拼 image_key
        String assetKey = storageService.save(STORAGE_PREFIX, filename, mimeType, bytes);

        BrandModel model = new BrandModel();
        model.setName(req.getName());
        model.setImageKey(assetKey);
        model.setMimeType(mimeType);
        model.setFileSize((long) bytes.length);
        model.setUserId(userId);
        model.setGroupId(groupId);
        model.setVisibility(group ? "shared" : "private");
        mapper.insert(model);

        SharedAsset asset = new SharedAsset();
        asset.setAssetKey(assetKey);
        asset.setBucket(LOGICAL_BUCKET);
        asset.setSourceService("tbfirst-image");
        asset.setSourceJobId(model.getId());
        asset.setUserId(userId);
        asset.setContentType(mimeType);
        asset.setFileSize((long) bytes.length);
        asset.setVisibility(group ? "shared" : "private");
        sharedAssetService.register(asset);

        return toResponse(model, storageService.resolveUrl(assetKey));
    }

    @Transactional
    public BrandModelDtos.BrandModelResponse rename(Long id, String newName) {
        BrandModel model = loadAndAuthorize(id, true);
        model.setName(newName);
        mapper.updateById(model);
        return toResponse(model, storageService.resolveUrl(model.getImageKey()));
    }

    @Transactional
    public void delete(Long id) {
        loadAndAuthorize(id, true);
        // @TableLogic 会把 deleteById 转换为：
        //   UPDATE image.brand_model SET deleted = 1, update_time = now(), update_by = ?
        //   WHERE id = ? AND deleted = 0
        mapper.deleteById(id);
    }

    private BrandModel loadAndAuthorize(Long id, boolean write) {
        UserContext ctx = requireContext();
        Long me = ctx.getUserId();
        // SQL: SELECT * FROM image.brand_model WHERE id = ? AND deleted = 0
        BrandModel model = mapper.selectById(id);
        if (model == null) {
            throw new BizException(ErrorCode.NOT_FOUND, "brand model not found");
        }
        if (!write) {
            return model;
        }
        if (isAdmin(ctx)) {
            return model;
        }
        Long mg = model.getGroupId();
        if (mg == null) {
            if (!me.equals(model.getUserId())) {
                throw new BizException(ErrorCode.FORBIDDEN, "无权修改他人个人模特");
            }
            return model;
        }
        if (ctx.getGroupId() == null || !mg.equals(ctx.getGroupId())) {
            throw new BizException(ErrorCode.FORBIDDEN, "无权修改其他组的模特");
        }
        boolean isUploader = me.equals(model.getUserId());
        boolean isLeader = "leader".equalsIgnoreCase(ctx.getGroupRole());
        if (!isUploader && !isLeader) {
            throw new BizException(ErrorCode.FORBIDDEN, "组内模特只有上传者本人或组长可修改 / 删除");
        }
        return model;
    }

    public List<BrandModelDtos.BrandModelResponse> listAllForAdmin(String scope, Long filterUserId, Long filterGroupId) {
        UserContext ctx = requireContext();
        if (!isAdmin(ctx)) {
            throw new BizException(ErrorCode.FORBIDDEN, "仅一级管理员可访问模特总览");
        }
        String s = scope == null ? "all" : scope.toLowerCase();
        List<BrandModel> all = mapper.selectList(
                new LambdaQueryWrapper<BrandModel>().orderByDesc(BrandModel::getId));
        return all.stream()
                .filter(m -> switch (s) {
                    case "personal" -> m.getGroupId() == null;
                    case "group" -> m.getGroupId() != null;
                    default -> true;
                })
                .filter(m -> filterUserId == null || filterUserId.equals(m.getUserId()))
                .filter(m -> filterGroupId == null || filterGroupId.equals(m.getGroupId()))
                .map(m -> toResponse(m, storageService.resolveUrl(m.getImageKey())))
                .toList();
    }

    private UserContext requireContext() {
        UserContext ctx = UserContextHolder.get();
        if (ctx == null || ctx.getUserId() == null) {
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        return ctx;
    }

    private boolean isAdmin(UserContext ctx) {
        return ctx.getRoles() != null && ctx.getRoles().contains("ADMIN");
    }

    private BrandModelDtos.BrandModelResponse toResponse(BrandModel m, String url) {
        BrandModelDtos.BrandModelResponse resp = new BrandModelDtos.BrandModelResponse();
        resp.setId(m.getId());
        resp.setName(m.getName());
        resp.setUrl(url);
        resp.setMimeType(m.getMimeType());
        resp.setFileSize(m.getFileSize());
        resp.setUserId(m.getUserId());
        resp.setGroupId(m.getGroupId());
        resp.setCreateTime(m.getCreateTime());
        return resp;
    }
}
