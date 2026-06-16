package com.tbfirst.image.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.image.entity.BrandModel;

/**
 * 品牌模特库 Mapper：对应 {@code image.brand_model}。
 *
 * <p>纯 {@link BaseMapper}，所有派生查询在 BrandModelServiceImpl 用 LambdaQueryWrapper 组装。
 * {@code @TableLogic} 让 selectList / deleteById 自动走逻辑删除语义。</p>
 */
public interface BrandModelMapper extends BaseMapper<BrandModel> {
}
