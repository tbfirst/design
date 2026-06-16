package com.tbfirst.cinestitch.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;

/**
 * MyBatis TypeHandler: Java String ↔ PostgreSQL JSONB。
 * 不引用 tbfirst-image 任何类——本地实现，cinestitch 模块私有。
 * 运行时 PG JDBC Driver 通过 Types.OTHER 识别列为 JSONB 进行正确的类型映射。
 */
public class PgJsonbStringTypeHandler extends BaseTypeHandler<String> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, String param, JdbcType jdbcType)
            throws SQLException {
        ps.setObject(i, param, Types.OTHER);
    }

    @Override
    public String getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return rs.getString(columnName);
    }

    @Override
    public String getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return rs.getString(columnIndex);
    }

    @Override
    public String getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return cs.getString(columnIndex);
    }
}
