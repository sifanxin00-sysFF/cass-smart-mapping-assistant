# CASS 智能成图助手 MVP 整体架构

## 产品定位

这是一个 CASS / CAD 前处理工具，不替代南方 CASS。网站把外业测点先整理成结构化项目：展点、人工确认连接关系、标注基础地物，再导出 DAT、DXF 和项目 JSON。

## 架构边界

前端负责：

- 上传点文件
- 字段映射确认
- 点位画布展示
- 点选、框选、连线、闭合面、点状地物编辑
- 维护项目 JSON
- 调用后端导出 DAT / DXF

后端负责：

- 解析 CSV / XLSX / DAT
- 返回字段候选和预览行
- 根据字段映射生成标准点数据
- 检查点号重复、坐标缺失、高程缺失、疑似 X/Y 反了、未闭合面、未使用点
- 导出 DAT
- 使用 ezdxf 导出 DXF

## 数据流

```text
上传点文件
  -> 后端解析原始表格
  -> 前端确认字段映射
  -> 后端生成标准 points
  -> 前端画布展点
  -> 用户创建 features
  -> 前端形成 project JSON
  -> 后端校验 / 导出 DAT / DXF
```

## 目录结构

```text
cass-smart-mapping-assistant
  README.md
  docs
    architecture.md
  samples
    sample_points.csv
    sample_points.dat
    sample_points.xlsx
    sample_project.json
  frontend
    package.json
    index.html
    src
      main.tsx
      App.tsx
      api.ts
      styles.css
      types
        project.ts
      utils
        geometry.ts
  backend
    requirements.txt
    pytest.ini
    app
      main.py
      models.py
      feature_types.py
      services
        parse_files.py
        validate.py
        export_dat.py
        export_dxf.py
      tests
        test_parse_files.py
        test_validate.py
        test_export_dxf.py
```

## API

- `POST /api/upload/points`：上传 CSV / XLSX / DAT，返回列名、预览行、自动字段映射。
- `POST /api/points/parse`：传入 `fileId` 和字段映射，返回标准点列表和检查结果。
- `POST /api/project/validate`：传入项目 JSON，返回错误和警告。
- `POST /api/export/dat`：传入项目 JSON，返回 DAT 文件。
- `POST /api/export/dxf`：传入项目 JSON，返回 DXF 文件。

## 第一版地物类型

| 类型 | key | 闭合 | 图层 |
|---|---|---:|---|
| 建筑物 | building | 是 | BUILDING |
| 道路边线 | road_edge | 否 | ROAD |
| 绿化带 | green_area | 是 | GREEN |
| 水池 | pond | 是 | WATER |
| 台阶 | stairs | 否 | STAIRS |
| 围墙 | wall | 否 | WALL |
| 独立树 | tree | 点状 | TREE |
| 井盖 | manhole | 点状 | MANHOLE |
| 普通线 | line | 否 | DEFAULT |

## 阶段实现顺序

1. 后端：模型、解析、校验、导出、测试。
2. 前端：上传、字段映射、点位预览。
3. 编辑：点选、框选、线/面/点状地物。
4. 导出：JSON / DAT / DXF。
5. 验收：样例文件、测试、构建、本地页面检查。
