package com.tbfirst.common.datasource.asset;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

/**
 * 跨服务共享资产 Mapper：对应 {@code asset.shared_asset} 表。
 *
 * <p><b>为什么放在 tbfirst-common-datasource：</b>
 * {@code asset} schema 是平台级"资源注册表"，多个业务服务（image / adimage / ...）
 * 都需读写。把 Mapper 放公共模块，消费方只需 {@code @MapperScan} 把
 * {@code com.tbfirst.common.datasource.asset} 包一并扫入即可。</p>
 *
 * <p><b>为什么没有业务 Service：</b>各业务模块对 shared_asset 的"查询组合"不一样
 * （image 常按 user，adimage 常按 bucket），统一硬塞一个 Service 反而不好用。
 * 因此只暴露 Mapper + 实体，各模块内各自有一个 SharedAssetLocalService 封装。</p>
 *
 * <p><b>能力：</b>纯 {@link BaseMapper}；派生查询在各模块的 LocalService 里用
 * LambdaQueryWrapper 按需组装。{@code @TableLogic} 驱动逻辑删除。</p>
 */
public interface SharedAssetMapper extends BaseMapper<SharedAsset> {
}
