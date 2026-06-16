package com.tbfirst.cinestitch.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.cinestitch.entity.StoryboardProject;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface StoryboardProjectMapper extends BaseMapper<StoryboardProject> {

    @Select("SELECT id, user_id, title, status, stage, cover_image_url, create_time "
          + "FROM cinestitch.storyboard_project "
          + "WHERE user_id = #{userId} AND deleted = 0 "
          + "ORDER BY create_time DESC "
          + "LIMIT #{limit} OFFSET #{offset}")
    List<StoryboardProject> listByUserIdNoDocJson(
            @org.apache.ibatis.annotations.Param("userId") Long userId,
            @org.apache.ibatis.annotations.Param("limit") int limit,
            @org.apache.ibatis.annotations.Param("offset") int offset);
}
