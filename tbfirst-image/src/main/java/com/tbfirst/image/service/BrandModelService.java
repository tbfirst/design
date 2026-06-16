package com.tbfirst.image.service;

import com.tbfirst.image.dto.BrandModelDtos;

import java.util.List;

/**
 * 品牌模特库服务接口。
 *
 * <p><b>职责：</b>管理 brand_model 表 —— 用户或组可上传"标准模特参考图"，
 * 后续生成任务可引用其 id 作为风格锚点。</p>
 *
 * <p><b>双作用域（scope）：</b></p>
 * <ul>
 *   <li>personal：归属 user_id，容量由 user.model_cap_override（null 回落 30）控制；</li>
 *   <li>group：归属 group_id，容量由 share_group.model_cap（null 回落 30）控制，组内成员共享。</li>
 * </ul>
 *
 * <p><b>实现：</b>{@link com.tbfirst.image.service.impl.BrandModelServiceImpl}，
 * 其内部在 upload 时会调用 {@link SharedAssetLocalService#register} 在跨服务 asset.shared_asset
 * 注册资源，实现 tbfirst-image ↔ tbfirst-adimage 等服务的资源互通。</p>
 */
public interface BrandModelService {

    /**
     * 列出当前用户可见的 brand_model 列表。
     * @param scope personal / group，决定查询 user_id 还是 group_id 维度
     */
    List<BrandModelDtos.BrandModelResponse> list(String scope);

    /**
     * 上传一张新的 brand_model 参考图。
     * <p>上传前会检查 scope 对应的容量上限（personal 用 user.cap，group 用 group.cap）；
     * 超出则抛 BizException。</p>
     */
    BrandModelDtos.BrandModelResponse upload(BrandModelDtos.UploadRequest req, String scope);

    /** 重命名 brand_model，只有所有者（personal）或组成员（group）才能改名。 */
    // todo 预留接口，Phase1 前端不调用，后续根据需要再完善请求参数（目前仅 name，后续可能增加 description 等）
    BrandModelDtos.BrandModelResponse rename(Long id, String newName);

    /**
     * 软删一条 brand_model（deleted=1）。
     * <p>不级联删除 asset.shared_asset 中的记录（保留跨服务可能仍在引用的资源）。</p>
     */
    void delete(Long id);

    /**
     * ADMIN 视角：跨用户/跨组列出 brand_model。
     * @param scope         personal / group / null(不限)
     * @param filterUserId  当 scope=personal 时用来筛选具体用户，null 则所有
     * @param filterGroupId 当 scope=group 时用来筛选具体组，null 则所有
     */
    List<BrandModelDtos.BrandModelResponse> listAllForAdmin(String scope, Long filterUserId, Long filterGroupId);
}
