package com.tbfirst.image.service;

import com.tbfirst.common.datasource.asset.SharedAsset;

import java.util.List;

/**
 * tbfirst-image 本地的跨服务共享资产 Service 接口。
 *
 * <p><b>为何存在本地包装：</b>tbfirst-common-datasource 仅提供 {@link SharedAsset} 实体和
 * SharedAssetMapper，没有业务 Service；由于不同业务模块对"同一张 asset 的创建/查询语义"
 * 各不相同（如 image 倾向于按 user 查、adimage 按 bucket 查），因此每个服务都维护一个
 * 自己的 Local Service，封装查询组合和业务默认值。</p>
 *
 * <p><b>实现：</b>{@link com.tbfirst.image.service.impl.SharedAssetLocalServiceImpl}。</p>
 */
public interface SharedAssetLocalService {

    /**
     * 注册一条跨服务共享资源（INSERT asset.shared_asset）。
     * <p>调用方通常是 BrandModelService.upload 完成本地落库后，同步在 shared_asset 中留影。</p>
     */
    SharedAsset register(SharedAsset asset);

    /** 列出某用户名下全部 shared_asset（不限 bucket）。 */
    List<SharedAsset> findByUser(Long userId);

    /** 列出某用户在指定 bucket 下的 shared_asset（如 bucket=brand_model）。 */
    List<SharedAsset> findByUserAndBucket(Long userId, String bucket);

    /** 列出某用户标记为 shared=true 的 shared_asset（组内或全局可见的那些）。 */
    List<SharedAsset> findSharedByUser(Long userId);

    /** 根据主键查询单条 shared_asset，查不到返回 null（不抛异常）。 */
    SharedAsset findById(Long id);
}
