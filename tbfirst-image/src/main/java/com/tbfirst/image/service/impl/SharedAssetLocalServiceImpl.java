package com.tbfirst.image.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.common.datasource.asset.SharedAsset;
import com.tbfirst.common.datasource.asset.SharedAssetMapper;
import com.tbfirst.image.service.SharedAssetLocalService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * tbfirst-image 本地的跨服务共享资产 Service 实现。
 *
 * <p><b>职责：</b>{@link SharedAssetLocalService} 的唯一实现，薄封装
 * {@link SharedAssetMapper}（来自 tbfirst-common-datasource）。
 * 所有查询都带 user_id 限定，防止越权访问他人资源。</p>
 */
@Service
@RequiredArgsConstructor
public class SharedAssetLocalServiceImpl implements SharedAssetLocalService {

    private final SharedAssetMapper mapper;

    public SharedAsset register(SharedAsset asset) {
        // SQL: INSERT INTO asset.shared_asset (asset_key, bucket, source_service, source_job_id,
        //      user_id, content_type, file_size, visibility, create_time, update_time,
        //      create_by, update_by, deleted)
        //      VALUES (?, ?, ?, ?, ?, ?, ?, ?, now(), now(), ?, ?, 0)
        mapper.insert(asset);
        return asset;
    }

    public List<SharedAsset> findByUser(Long userId) {
        // SQL: SELECT * FROM asset.shared_asset
        //      WHERE user_id = ? AND deleted = 0 ORDER BY create_time DESC
        return mapper.selectList(new LambdaQueryWrapper<SharedAsset>()
                .eq(SharedAsset::getUserId, userId)
                .orderByDesc(SharedAsset::getCreateTime));
    }

    public List<SharedAsset> findByUserAndBucket(Long userId, String bucket) {
        // SQL: SELECT * FROM asset.shared_asset
        //      WHERE user_id = ? AND bucket = ? AND deleted = 0 ORDER BY create_time DESC
        return mapper.selectList(new LambdaQueryWrapper<SharedAsset>()
                .eq(SharedAsset::getUserId, userId)
                .eq(SharedAsset::getBucket, bucket)
                .orderByDesc(SharedAsset::getCreateTime));
    }

    public List<SharedAsset> findSharedByUser(Long userId) {
        // SQL: SELECT * FROM asset.shared_asset
        //      WHERE user_id = ? AND visibility = 'shared' AND deleted = 0 ORDER BY create_time DESC
        return mapper.selectList(new LambdaQueryWrapper<SharedAsset>()
                .eq(SharedAsset::getUserId, userId)
                .eq(SharedAsset::getVisibility, "shared")
                .orderByDesc(SharedAsset::getCreateTime));
    }

    public SharedAsset findById(Long id) {
        // SQL: SELECT * FROM asset.shared_asset WHERE id = ? AND deleted = 0
        return mapper.selectById(id);
    }
}
