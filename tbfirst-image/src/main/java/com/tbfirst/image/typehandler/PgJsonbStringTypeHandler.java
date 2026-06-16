package com.tbfirst.image.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.apache.ibatis.type.MappedTypes;
import org.postgresql.util.PGobject;

import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * PostgreSQL JSONB ↔ Java String 类型处理器。
 *
 * <p>业务代码已经把 JSON 结构 serialize 到 String 了；这里仅把 String
 * 包装成 PGobject(jsonb) 喂给 JDBC，避免 PostgreSQL 抛 "column is of type jsonb
 * but expression is of type varchar"。读取时把 PGobject.value 或 String 还原为 String。</p>
 */
@MappedTypes(String.class)
@MappedJdbcTypes(JdbcType.OTHER)
public class PgJsonbStringTypeHandler extends BaseTypeHandler<String> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, String parameter, JdbcType jdbcType) throws SQLException {
        PGobject obj = new PGobject();
        obj.setType("jsonb");
        obj.setValue(parameter);
        ps.setObject(i, obj);
    }

    @Override
    public String getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return toStr(rs.getObject(columnName));
    }

    @Override
    public String getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return toStr(rs.getObject(columnIndex));
    }

    @Override
    public String getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return toStr(cs.getObject(columnIndex));
    }

    private String toStr(Object raw) {
        if (raw == null) return null;
        if (raw instanceof PGobject p) return p.getValue();
        return raw.toString();
    }
}
