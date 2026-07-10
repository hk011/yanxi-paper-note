---
name: yanxi
description: |
  研析论文解读方法论：PDF 提取 → 结构化 → 三阶段中文笔记（联网 + 配图）。
  触发词：研析、yanxi、解读论文、论文笔记、研析笔记。
  Agent 用 PaddleOCR（首选）或 Kreuzberg（备选）提取 PDF，无需启动研析后端或 API Key。
  按本 Skill 的三阶段流水线输出 Markdown 笔记、转为 PDF；PDF 生成后交付前须 Agent 自检通过，再 send_file_to_user。
metadata:
  requires:
    bins: []
---

# 研析（Yanxi）论文解读 Skill

> AI 驱动的英文学术论文中文解读流水线：PDF 解析 → 结构化 → 三阶段笔记（联网 + 配图）→ PDF 交付。

**Core Pipeline**: `PDF（PaddleOCR → 备选 Kreuzberg）→ 三阶段笔记 → note.md → note.pdf → **交付前自检 PASS** → send_file_to_user`

> [!CAUTION]
> ## 🚨 全局执行纪律（MANDATORY）
>
> 1. **三阶段笔记是质量核心** — 必须执行：阶段一大纲 → 阶段二六章 → 阶段三综合终稿；**禁止**跳过阶段一直接写终稿，**禁止**用单段摘要代替完整流水线
> 2. **只裁 Figure、禁止整页当图** — `images/` 每张须为**单个 Figure/Table 图表区域**（仅图表本身，不含整页）；**禁止**整页 PDF 截图充当原图；裁剪边界须含图内**全部**文字标签与矢量元素（见 §1.3.4）；插图自检**对照原论文 `source.pdf`**（见「术语」）
> 3. **图片必须对齐 Figure** — 禁止匿名批量抽图（如 `extracted image 1`）；每张图须绑定正文 `Figure N` 图题；catalog 格式与 Web 端一致；**校验通过后再写笔记**
> 4. **PDF 提取：PaddleOCR 首选** — 论文内容**首选 PaddleOCR** 解析；**安装失败或运行超时**时改 **Kreuzberg**；无论哪条路径都须 §1.3.4 裁剪规范；**勿因装包调试而省略三阶段**
> 5. **NO YANXI BACKEND** — 不要求 `YANXI_API_KEY`；笔记**结构与 Prompt** 与研析 Web 端 `note_pipeline` 一致
> 6. **UTF-8 ONLY** — 所有 `.md` / `.txt` 必须用 **UTF-8** 读写；Windows **禁止** `Out-File`（默认 UTF-16/GBK）、禁止 `pandoc` 无 CJK 引擎直接转 PDF（中文会乱码）
> 7. **PDF DELIVERY ONLY** — 用户最终 MUST 收到 `{论文简称}_yanxi_note.pdf`
> 8. **SELF-CHECK BEFORE DELIVERY** — PDF 生成后、`send_file_to_user` 前 MUST 自检；**必查两项图片问题**：① 是否把**整页**当 Figure 图；② Figure 是否**裁切不全**（边缘信息丢失）；存在则按 Step 7 自行修复后再交付，**禁止**带病交付
> 9. **NO FABRICATION** — 禁止编造图片路径、URL、引用来源
> 10. **MODEL LOCK** — 三阶段笔记全程同一 LLM：优先豆包 Seed（若已接入），否则**当前会话模型**；禁止切换到 Agent 上其他模型

> [!IMPORTANT]
> ## 定位
>
> 本 Skill 提供**研析笔记生成方法论**（流程 + Prompt 规范）。PDF 内容**首选 PaddleOCR**，失败或超时改 **Kreuzberg**；可选 Agent Reach 增强联网。

## 术语（Agent 必读）

| 名称 | 含义 | 如何确定 |
|------|------|----------|
| **`source.pdf`** | 用户提供的**待解读原论文 PDF**（英文论文；Skill 的**唯一输入 PDF**） | 用户消息中的路径/附件；或 Agent 复制到工作目录后命名为 `paper_work/source.pdf` |
| **`parsed.md`** | 从原论文提取的结构化 Markdown（中间产物） | Step 1 产出 |
| **`note.md`** | 三阶段生成的中文解读笔记（中间产物） | Step 5 产出 |
| **`note.pdf` / `{简称}_yanxi_note.pdf`** | 交付给用户的中文解读笔记 PDF（**输出**，不是 `source.pdf`） | Step 6 产出 |

> **`source.pdf` 不是笔记 PDF**。全文凡写「对照 `source.pdf`」「从 `source.pdf` 提取 Figure」，均指**用户给的那篇原论文**，不是 `note.pdf`、不是 Web 端笔记、不是 Agent 生成的任何文件。

## 本 Skill 使用的组件

| 阶段 | 组件 | 说明 |
|------|------|------|
| PDF → 结构化正文 + 原图 | **PaddleOCR**（首选）→ **Kreuzberg**（备选） | 见 Step 1；**逐 Figure 对齐**原图 |
| 笔记联网检索 | **`web_search` / 浏览器**（DEFAULT）；可选 Agent Reach | 见 Step 2 |
| 笔记正文 LLM | 豆包 Seed（优先）或**当前会话模型** | 见 Step 3 |
| AI 配图 | Agent 文生图（可选） | 见「配图 Prompt 规范」 |
| 交付 | `note.md` → PDF → **交付前自检** → `send_file_to_user` | 见 Step 6、Step 7 |

## Main Pipeline Tools

| 工具 / 包 | Step | 用途 |
|-----------|------|------|
| **PaddleOCR** PP-StructureV3 | 1 | PDF 解析**首选**（版面 + OCR + Markdown + 图表） |
| **Kreuzberg** | 1 | PaddleOCR 安装失败 / 超时 / 报错时的**备选** |
| `web_search` / 浏览器 | 2, 5 | 背景、综述、GitHub 等（DEFAULT） |
| `agent-reach` | 2, 5 | 联网增强（OPTIONAL） |
| 当前会话模型 / 豆包 Seed | 3, 5 | 大纲 / 分章 / 综合 |
| 浏览器 / PDF 阅读 / 读图 | 7 | 交付前自检 PDF 正文与插图 |
| `pandoc` / 浏览器打印等 | 6 | `note.md` → PDF（Agent 自选，须保证中文） |
| `send_file_to_user` | 7 | 自检通过后交付 PDF |

> **与 Web 端研析的差异**：Web 端用 MinerU VLM；Skill **仅** PaddleOCR + Kreuzberg 两档解析；Figure 对齐由 Agent 对照 `source.pdf` 后处理。笔记**结构与写作规范**与 Web 端一致。

## 编码与文件 I/O 规范（Windows 必遵，防乱码）

**乱码主因**：Windows 默认 GBK/UTF-16 写文件，或 PDF 转换未嵌入中文字体。以下规则 **MANDATORY**：

| 操作 | 正确做法 | 禁止 |
|------|----------|------|
| 写 `.md` / `.txt` | Agent 文件工具，**UTF-8** 编码保存 | Windows 下 `Out-File`、`Set-Content`、`|>` 重定向 |
| 读 Markdown | Agent 文件工具，按 UTF-8 读取 | 按系统默认 GBK 解读 |
| PDF 转中文 | HTML（UTF-8 + 系统中文字体）→ 浏览器打印为 PDF | 未配置 CJK 的 pandoc 直转 |

**写入后校验**（`parsed.md`、`outline.txt`、`note.md` 每次保存后执行）：

1. 用 UTF-8 重新读取文件，目视前 500 字：中文可读、无「锟斤拷」「Ã©」「ï¿½」等替换符
2. 若乱码 → 删除文件，用 UTF-8 方式重写；**禁止**将乱码内容传入三阶段 Prompt

**PDF 转后校验**：在 Step 7 打开 PDF 检查；若方块/乱码 → 换 Step 6 转换方式，勿交付。

---

## Workflow

### Step 1: PDF 文字提取与结构化

🚧 **GATE**：用户已提供**待解读原论文 PDF**。

**第一步**：将该 PDF 定为 **`source.pdf`**（见「术语」）—— 复制或链接到 `paper_work/source.pdf`，或全程使用用户给出的绝对路径并在上下文中记为 `source.pdf`。后续 Step 1–7 中凡出现 `source.pdf`，均指此**原论文输入文件**。

#### 1.1 目标

得到两份材料，供后续笔记生成使用：

1. **`parsed.md`**：论文结构化 Markdown
   - 保留章节层级（`#` / `##` / `###`）
   - 公式用 `$...$` 或 `$$...$$`
   - 表格用 GFM 表格
   - 图片：`![Figure 1: 图题说明](images/文件名.jpg)`（路径必须真实存在）

2. **`image_catalog`（图片清单）**：每张图一条记录

```text
- images/fig1.jpg | Figure 1 | 模型整体架构示意图 | p3
- images/fig2.png | Figure 2 | 各数据集上准确率对比 | p7
```

#### 1.2 提取要求

- **全文覆盖**：摘要、引言、方法、实验、结论、参考文献要点
- **专业术语**：首次出现可保留英文并附中文，如 Transformer（变换器）
- **图题绑定**：每张图必须有 Figure 编号 + 图题说明；禁止编造不存在的图片路径
- **页码标注**（可选）：段落前加 `[p3]` 便于溯源
- **文件编码**：`parsed.md`、`image_catalog.txt` 一律 **UTF-8** 写入（见「编码与文件 I/O 规范」）
- **正文可读性**：PaddleOCR / Kreuzberg 产出不可读时，改用 Agent 逐页阅读或 OCR；**禁止**将乱码正文写入 `parsed.md`

#### 1.3 论文内容提取（首选 PaddleOCR，备选 Kreuzberg）

**策略**：论文 PDF 的正文、表格、版面结构 **首选 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) PP-StructureV3** 提取（Skill 侧替代 Web 端 MinerU 的角色）。**仅当** PaddleOCR **安装失败、运行报错或超时** 时，改用 **[Kreuzberg](https://github.com/kreuzberg-dev/kreuzberg)**。

| 优先级 | 工具 | 说明 |
|--------|------|------|
| **1（DEFAULT）** | PaddleOCR PP-StructureV3 | 文档解析 → Markdown + 图表块 |
| **2（FALLBACK）** | Kreuzberg | PaddleOCR 不可用时的正文/表格备选 |

无论哪条路径，论文原图仍须 **§1.4 逐 Figure 对齐**；**禁止**未绑定 Figure 的批量抽图进入 `image_list`。

##### 1.3.1 首选：PaddleOCR

**检查与安装**（Agent 进入 Step 1 时执行；未安装则 `pip install`）：

```bash
# 推荐 Python 3.9+；Windows 下 python3 失败可改用 python
pip install "paddleocr[doc-parser]"
# 若缺少 Paddle 推理引擎，按官方文档安装 CPU 版，例如：
# pip install paddlepaddle
```

**运行示例**（CLI，输出到工作目录）：

```bash
paddleocr pp_structurev3 -i paper_work/source.pdf --save_path paper_work/paddle_out
```

Agent 亦可用 PaddleOCR Python API / 自身代码执行能力调用 PP-StructureV3，效果等价于上述 CLI。

**超时规则**：

- 长论文解析可能较慢；Agent 对单次 PaddleOCR 任务设 **建议上限 10–15 分钟**（或按页数合理预估）
- 若 **超时仍未完成**、进程无响应或被终止 → **停止等待，改走 §1.3.2 Kreuzberg**
- 超时切换 **不算失败**，但须在日志中说明已降级

**产出整理**（写入 `paper_work/`）：

1. 将 `paddle_out/` 中的 Markdown **合并**为 `parsed.md`（UTF-8），保留 `#` / `##` 层级与 GFM 表格
2. 将解析得到的图表文件放入 `images/`，并按 §1.4 **绑定 Figure N / 图题**（禁止 `extracted image 1` 等匿名命名）
3. 若 Paddle 导出图无法与 Figure 编号自动对应 → 按 **§1.3.4** 对照 `source.pdf` **区域裁剪**（禁止整页截图）

**PaddleOCR 成功标准**：`parsed.md` 含摘要/方法/实验等核心章节，长度明显大于摘要 alone；否则视为产出不足，可尝试 Kreuzberg 或重跑。

##### 1.3.2 备选：Kreuzberg

**触发条件**（满足任一即切换，无需用户确认）：

| 条件 | 说明 |
|------|------|
| 安装失败 | `pip install paddleocr` / 依赖报错且无法修复 |
| 运行失败 | `pp_structurev3` 或 API 调用报错且无法修复 |
| **超时** | 超过 §1.3.1 建议时限仍未完成 |
| 产出不足 | 正文过短、章节缺失、明显解析失败 |

**安装与运行**：

```bash
pip install kreuzberg
```

Agent 用 Kreuzberg 解析 `source.pdf`，将正文写入 `parsed.md`（UTF-8）。具体调用方式由 Agent 按 Kreuzberg 文档执行（`extract_file` 等）。

**Kreuzberg 使用限制（MUST）**：

- 可用 Kreuzberg 补 **正文、表格 Markdown**
- Kreuzberg 的 `result.images` **未经 Figure 绑定** 不得直接进入 `image_list`
- 论文原图须 Agent **对照 `source.pdf` 逐 Figure 提取/对齐** 到 `images/`（优先用 PaddleOCR 产出图表；不足时结合 Kreuzberg 或 Agent 读 PDF），再按 §1.4 建 catalog

##### 1.3.3 两条路径共通纪律

**PDF 解析工具仅此二者**：PaddleOCR（首选）→ Kreuzberg（备选）。**禁止**再引入 PyMuPDF 等第三套 PDF 库做正文/图表提取（与二者功能重复）。

| 任务 | 方式 |
|------|------|
| 正文文字 | PaddleOCR（首选）或 Kreuzberg（备选）→ `parsed.md` |
| 论文原图 | **逐 Figure 对齐**：识别 `Figure N` 图题 → 定位页码 → 导出到 `images/` |
| 表格 | GFM 表格写入 `parsed.md`；catalog 中标注「表」 |

**MUST NOT**：

- 按 `extracted image 1/2/3`、`fig_p003_02` 等匿名顺序命名后直接写入 catalog
- 将 PDF 内全部 embedded 图片无差别导出（顺序常与 Figure 编号不一致，会导致笔记配图全错）
- 使用 Kreuzberg / PaddleOCR 导出的图片 **未经 Figure 绑定** 就进入 `image_list`
- 在输入残缺（正文过短、Figure 未对齐）时进入 Step 5 写笔记

##### 1.3.4 论文原图裁剪规范（MANDATORY）

**目标**：`images/` 中每张图 = 论文 **`source.pdf` 里的一个 Figure/Table 图表本身**——**只有图，不是图所在整页**。

> **实际使用场景**：用户通常**只提供原论文 PDF**（`source.pdf`），**不会**也**不应要求**用户提供 Web 端笔记或其它参考 PDF 做对比。Agent 的所有图片自检**唯一对照物是 `source.pdf`** 中对应 Figure/Table。

> **常见 Agent 失误（必须避免）**
>
> | 失误 | 表现 | 根因 |
> |------|------|------|
> | **整页当图** | 笔记插图是一整页 PDF（含正文、页眉、多段文字） | 对 PDF 页做**无区域限制**的全页渲染/截图（如整页 `get_pixmap()` 无 clip） |
> | **裁切不全** | Figure 3 等分类图**左侧竖排标签、图例、箭头**被切掉 | 边界框只算了 **drawings（矢量线框）**，未纳入**图内 text 文本块**和 **embedded 嵌入图** |
> | **裁切过宽** | 一张图里混入相邻 Figure 或栏外正文 | 未以 `Figure N:` 图题为锚点收窄区域 |

**优先级（提取单张 Figure 时按序尝试）**：

1. **PaddleOCR PP-StructureV3 导出的独立图表块**（已是版面分析后的 figure region）→ 绑定 Figure N 后直接用
2. Kreuzberg / Paddle 产出中**已隔离**的图表文件 → 绑定 Figure N 后使用
3. 仍不足时：Agent **对照 `source.pdf` 按区域裁剪**（见下），**禁止**退化为整页截图

**区域裁剪算法（Agent 用代码或工具执行时须遵守）**：

```
1. 定位锚点：在该页找到 "Figure N:" / "Fig. N" 图题（及 Table N 同理）
2. 确定范围：从图题向上/向下扩展到该 Figure 的**独占视觉区域**
   - 上界：上一段正文或上一个 Figure 之下
   - 下界：图题 Caption 之上（Caption 可写在 parsed.md，不必裁进 PNG）
   - 左右：仅 Figure **所在栏**（双栏论文禁止跨栏）
3. 计算边界框 = 该区域内所有视觉元素的**并集（union）**：
   - 矢量 drawings（线、矩形、路径）
   - **text 文本块**（含竖排标签如 "Instance Level"、图例、子图标题）
   - embedded 嵌入位图
   ⚠ 不要只用 drawings；分类树/流程图/多子图常靠 text 定左右边界
4. 外扩 padding：四边各留 **2–5%** 页宽/高（或 ≥8pt），避免贴边切字
5. 渲染/导出：只导出该 **clip 矩形** 内的像素 → images/figure_N.jpg
6. 目检：与 source.pdf 同 Figure 并排对比，确认无整页、无裁切缺失
```

**MUST NOT**：

- 整页渲染/截图后当作 `images/figure_N.jpg`（无论是否缩放）
- 文件名含 `page_`、`fullpage`、`screenshot` 且内容为整页
- 仅用 drawings 的 min/max 算边界而**排除** Figure 区域内的 text
- 为「去噪」过滤掉宽/高 <15pt 的元素，若它们属于 Figure 内标签/图例
- 双栏 PDF 裁到另一栏的正文

**裁切质量自检（每张 Figure 导出后立即做）**：

| 检查 | 通过标准 |
|------|----------|
| 非整页 | 图中**不应**出现页眉、页码、大段正文段落、多个 Figure |
| 边缘完整 | 图内文字标签、色块、箭头、图例**四边完整**，无截断 |
| 图意一致 | 与 `source.pdf` 该 Figure 视觉一致，不是相邻 Figure 或表格碎片 |
| 分辨率 | 文字与线条清晰可读（若模糊则扩大 clip 或提高渲染 DPI 后重裁） |

**交付标准**：每张 `images/` 文件须为**单图裁剪 + Figure 图题绑定**；宁可多留 padding 也不要裁切不全，**禁止**用整页截图凑数。

#### 1.4 图片 catalog 构建（对齐 Web 端 `build_image_catalog`）

Web 端从 `parsed.md` 的 `![](images/...)` 与图题行、以及 MinerU `content_list` 合并 catalog。Skill 无 MinerU 时，Agent **手动复现同一逻辑**：

**Step A — 写入 `parsed.md` 时嵌入图片**

每提取一张论文原图，在正文中对应位置插入（图题行**紧跟**图片 Markdown，便于解析）：

```markdown
![Figure 1: Architecture overview](images/figure_1.jpg)
Figure 1: Architecture overview of the proposed method.
```

**Step B — 从 `parsed.md` 生成 `image_list`（注入 Prompt 的格式须与 Web 端 `format_image_catalog` 一致）**

```text
- [图] [p3] Figure 1 Architecture overview → 引用：![](images/figure_1.jpg)
- [图] [p7] Figure 2 Accuracy on benchmark datasets → 引用：![](images/figure_2.jpg)
- [表] [p5] Table 1 Main results → 引用：![](images/table_1.png)
```

规则：

1. 按图片在 `parsed.md` 中**首次出现顺序**排列
2. `caption` 取自 Figure/Table 正文图题（非「extracted image N」）
3. `kind`：`figure`→「图」、`table`→「表」、实验曲线→「图表」
4. 每条末尾 `→ 引用：![](images/xxx)` 的路径必须真实存在

同步写入 `image_catalog.txt`（内容与 `image_list` 相同，UTF-8 编码，便于后续对照）。

**Step C — 原图对齐**

PaddleOCR / Kreuzberg 产出图表后，按 **§1.3.4** 完成 Figure 绑定与区域裁剪；**禁止**整页截图或仅用 drawings 边界。**禁止**按 embedded 图片序号批量导出后直接写入 catalog。

#### 1.5 工作目录

```
paper_work/
  source.pdf
  paddle_out/        # PaddleOCR 原始输出（可选保留）
  parsed.md
  images/
  image_catalog.txt
  assets/
  outline.txt
  section_drafts/
  note.md
  note.pdf
```

#### 1.6 `paper_skeleton` 与 `image_list`

将 `parsed.md` 压缩为骨架（建议 ≤12000 字）：

```text
[p1] text: Abstract — ...
[p2] title: Introduction
[p3] figure: Figure 1 Architecture of ...
[p4] table: Table 1 Results on ...
```

若无法精细分块，截取 `parsed.md` 前 12000 字。

**`image_list`**：使用 §1.4 Step B 的 Web 端格式（`- [图] [pN] caption → 引用：![](images/...)`），**不要**改用简化编号列表。

#### 1.7 图片校验 GATE（进入 Step 5 前必做）

🚧 **GATE**：每张 catalog 条目须通过以下检查，**任一失败则回到 §1.3.3–1.4 重提**：

1. 打开 `images/` 中对应文件，目视确认内容与 catalog 中 **Figure/Table 编号、图题**一致
2. **非整页**：图中不含页眉、页码、大段正文或其它 Figure（见 §1.3.4）
3. **边缘完整**：图内标签/图例/箭头无裁切缺失（尤其分类图、多子图）
4. `parsed.md` 内 `![](images/...)` 路径均存在且与 catalog 一致
5. 无「extracted image」「fig_pXXX」「page_」等未绑定 Figure 的条目
6. Figure 数量与论文正文一致（缺图须说明并补提，不可跳过）

**✅ Checkpoint — `parsed.md`、`images/`、`image_list` 已校验。进入 Step 2。**

---

### Step 2: 联网补充（非阻塞）

🚧 **GATE**：Step 1 完成。

写笔记时需背景、综述、GitHub、解读博客等，**主动联网检索**。

| 方式 | 说明 |
|------|------|
| **DEFAULT** | Agent 自带 `web_search`、浏览器 |
| **OPTIONAL** | [Agent Reach](https://github.com/Panniantong/Agent-Reach)（`pip install agent-reach` + `agent-reach install --env=auto`） |

**MUST NOT**：因 Agent Reach 未安装而跳过三阶段笔记。无法联网时使用 Step 4 的「联网关闭 System」变体。

> **与图片流水线隔离**：Step 2 联网**不影响** Step 1 的 Figure 裁剪（§1.3.4）与 Step 7 的 B1/B2 自检。Step 7 仅因图片问题修复时，**只**重做 §1.3.4 → Step 6 → Step 7，**禁止**因此重做 Step 2 或 Step 5。

**✅ Checkpoint — 确认联网方式（有则用，无则降级）。进入 Step 3。**

---

### Step 3: 笔记 LLM 选型

笔记三阶段**全程同一模型**：

- 已接入 **豆包 Seed 2.0** → 优先使用
- 否则 → **当前会话模型**（用户触发研析时对话里正在用的模型，如 DeepSeek）

**禁止**切换到 Agent 上其他模型。「备选」仅指联网文案、PDF 工具等，**不表示可换 LLM**。

**✅ Checkpoint — 已确定笔记 LLM。进入 Step 4。**

---

### Step 4: 系统 Prompt（全程使用）

每次调用大模型写笔记时，**System** 内容（**联网开启，DEFAULT**）：

```text
你是一位资深科研论文解读专家，擅长将英文学术论文转化为结构化、通俗易懂的中文 Markdown 解读笔记。

要求：
1. 使用中文撰写，专业术语可保留英文并附中文解释
2. 输出标准 Markdown，不要包裹在代码块中
3. 引用论文原图时使用 Markdown 图片语法，路径必须从「可用图片清单」中选择，且必须与清单中标注的 Figure/图题一致
4. 需要补充背景、综述、解读博客、GitHub 代码等信息时，主动联网检索
5. 搜索优先：概念背景、相关综述、论文解读博客、GitHub 开源仓库
6. 不要编造不存在的链接；引用搜索结果时标注来源
7. 表格必须使用标准 GFM Markdown：表格前后各留一个空行，表头、分隔行、数据行独占一行；不要把表格写进列表项、段落、引用块或同一行文本中；表格单元格内不要使用裸竖线，必要时用"/"替代
8. 不要使用 emoji 或特殊彩色符号表示是/否，表格中统一使用"是/否/部分"

【配图原则】
- 优先引用论文原图（images/ 路径）
- 仅当「画一张图能明显帮助读者理解当前内容」时，再调用文生图工具生成辅助图
- 生成图保存到 assets/，笔记中用 ![](assets/文件名.png) 引用，并注明「AI 生成示意图」
- 文生图提示词：16:9 横构图，扁平矢量插画，色彩明快，图内中文文字用双引号逐字写出，数值须具体
```

**备选 — 联网关闭 System**（Agent 不支持联网时，将第 4–6 条替换为）：

```text
4. 仅依据论文原文、解析内容与已有知识撰写
5. 禁止调用联网搜索；需要外部背景时写「可进一步检索」而非虚构链接
6. 不要编造不存在的 URL 或引用来源
```

**✅ Checkpoint — System 已选定。进入 Step 5。**

---

### Step 5: 三阶段笔记流水线

🚧 **GATE**：Step 1–4 完成；`paper_skeleton` 与 `image_list` 已通过 §1.7 校验。

与研析 Web 端 `note_pipeline` 一致，**必须按顺序执行**，不可跳过阶段一。

> **长论文提示**：阶段二可并行或串行；整体任务可能需数分钟。**禁止**中途用简化摘要代替完整流水线。

```
阶段一 outline  →  阶段二 draft（6 章）  →  阶段三 final → note.md
```

#### 5.1 阶段一：解读大纲

**User Prompt 模板**（替换 `{paper_skeleton}`、`{image_list}`）：

```text
请根据以下论文结构化解析内容，输出「解读大纲」（纯文本，不要完整笔记）：

1. 论文基础信息表（标题中英文、作者、单位、期刊/会议、发表时间、代码/数据链接——能从文中推断则填，否则标「未提及」）
2. 章节大纲（按论文实际结构）
3. 关键概念列表（中英文，标注哪些概念可能需要联网补充背景）
4. 重要图片清单（从正文中识别 Figure 编号 + 说明；后续章节须按清单中的路径引用，不要自行猜测文件名）

【可用图片清单】（含路径绑定，大纲阶段请据此整理图片清单）
{image_list}

---
{paper_skeleton}
```

输出保存为 `outline.txt`（UTF-8），或在上下文中传递给阶段二。

#### 5.2 阶段二：六章并行起草

对以下 **6 个章节分别调用一次**大模型（可并行）。每章**独立撰写**，只输出该章 Markdown（含 `##` 标题）。

| 章节 | 标题 | 撰写要点 |
|------|------|----------|
| 1 | 一、论文基础信息 | Markdown 表格：标题（原文+译文）、作者、单位、期刊/会议、发表时间、代码库、数据集等 |
| 2 | 二、背景、动机与结果 | 核心贡献总结、研究背景与动机、主要结果概览；需要背景时联网搜索 |
| 3 | 三、核心方法 | 技术架构详解、关键算法、创新点；**必须详细描述架构图/方案图**（优先引用原图）；可文生图辅助 |
| 4 | 四、实验结果 | 实验设置、主要结果分析（引用论文图表并解读）、对比实验（可用表格） |
| 5 | 五、总结与展望 | 研究价值、局限性、未来方向 |
| 6 | 六、扩展阅读 | 相关论文推荐、参考资料与链接（可联网搜索补充） |

**每章 User Prompt 模板**（替换占位符）：

```text
你正在为一篇论文撰写中文解读笔记。

【已完成大纲】
{outline}

【论文结构化内容摘要】
{paper_skeleton}

【可用图片清单】（每项已绑定图题/类型与路径；引用时必须使用箭头右侧的路径，格式：![](images/文件名.jpg)）
{image_list}

【当前任务】
{section_instruction}

请直接输出本章 Markdown 内容（含章节标题如 ## 一、...）。本章独立撰写，无需参考其他章节草稿。
```

`{section_instruction}` 取上表对应章节的「撰写要点」全文。

**第三章节**是配图重点：若原图不足以说明，调用文生图工具，参考「配图 Prompt 规范」。

#### 5.3 阶段三：综合重写终稿

将六章草稿**整体重写**为一篇连贯笔记（禁止机械拼接）。

**User Prompt 模板**：

```text
请基于前面各阶段得到的资料与草稿，输出一篇完整、连贯、图文并茂的中文论文解读笔记。

【论文标题】
{paper_title}

【论文解读大纲】
{outline}

【分阶段草稿材料】（这些只是材料，不要机械拼接；请整体重写成一篇连贯笔记）
{section_drafts}

【论文结构化内容摘要】
{paper_skeleton}

【可用论文原图】（每项已绑定图题/类型与路径；引用时必须使用箭头右侧的路径）
{image_list}

【已生成辅助讲解图】（引用格式：![](assets/文件名.png)）
{generated_images}

输出要求：
1. 只输出最终 Markdown 正文，不要解释过程，不要包裹代码块。
2. 文章结构必须包含：论文基础信息、背景/动机/结果、核心方法、实验结果、总结展望、扩展阅读。
3. 图文并茂：在合适位置插入论文原图和已生成配图（assets/ 路径），并在图下方简要说明图意；AI 生成的配图需注明为示意。
4. 语言要连贯，避免"第一段草稿/第二段草稿"这种拼接感。
5. 所有外部资料链接要标注来源，不要编造来源。
6. 所有 Markdown 表格必须是标准 GFM 表格：表格前后必须空一行，表头、分隔线、每行数据都独占一行；不要在列表项里直接插入表格。
7. 表格内避免使用 emoji、HTML、未转义的竖线。是/否统一写"是""否""部分"。
```

将输出写入 **`note.md`**（UTF-8 编码保存）。

**✅ Checkpoint — `note.md` 已生成。进入 Step 6。**

---

### Step 6: Markdown → PDF

🚧 **GATE**：`note.md` 已写入。

用 Agent **自身已有工具**将 `note.md` 转为 `{论文简称}_yanxi_note.pdf`。本 Skill **不提供**专用 Python 脚本，由 Agent 选择下列方式之一。

#### 6.1 转换前准备

1. `note.md` 与 `images/`、`assets/` 在同一工作目录，图片用相对路径
2. 确认 `note.md` 中文可读（UTF-8）

#### 6.2 推荐转换方式（Agent 自选，须保证中文不乱码）

**方式 A（推荐）**：`note.md` → `note.html`（`<meta charset="UTF-8">`，CSS 指定系统中文字体：Windows 微软雅黑 / macOS PingFang SC / Linux Noto Sans CJK）→ 浏览器打开 → **打印为 PDF**，勾选「背景图形」

**方式 B**：`pandoc` + `xelatex`，并指定 CJK 字体（Windows：`Microsoft YaHei`；macOS：`PingFang SC`；Linux：`Noto Sans CJK SC`）

**MUST NOT**（易导致 PDF 中文乱码，即使 `note.md` 正常）：

- `pandoc note.md -o note.pdf` 且未配置 xelatex + CJK 字体
- 无头转换工具未验证中文渲染效果

#### 6.3 生成后

确认 `note.pdf` 文件头为 `%PDF`，然后**进入 Step 7 交付前自检**（不可跳过）。

**✅ Checkpoint — `note.pdf` 已生成。进入 Step 7。**

---

### Step 7: 交付前自检与交付

🚧 **GATE**：`note.pdf` 已生成。**自检未通过不得 `send_file_to_user`。**

> **时机**：在 **PDF 已生成、尚未交给用户** 时，Agent **必须自行**打开 `note.pdf` 检查。**对照物**：正文看 `note.md`；**每一张论文原图**与 **`source.pdf` 中同 Figure 并排核对**（不要求用户提供其它参考 PDF）。

#### 7.1 自检流程

```
note.pdf 已生成
  → 打开 note.pdf + source.pdf
  → 检查 A：正文中文是否乱码/方块
  → 检查 B1【必查】：是否存在「整页当 Figure 图」
  → 检查 B2【必查】：是否存在「Figure 裁切不全 / 边缘信息丢失」
  → 检查 B3：是否乱图、错绑 Figure、路径错误
  → 全部通过 → send_file_to_user
  → B1/B2/B3 任一失败 → 查因 → 修复 images/ 与 note.md → Step 6 重转 PDF → 再执行本 Step（最多 3 轮）
```

#### 7.2 图片专项自检（交付前必做）

**对 `note.pdf` 中每一张来自 `images/` 的论文原图**，以及 `images/` 源文件本身，**逐张**执行下列两项检查。**任一张 FAIL 则整份笔记不得交付**。

##### 问题 ①：整页当 Figure 图（整页截图）

| 项目 | 说明 |
|------|------|
| **是什么** | 笔记插图是一整页 PDF，而非单个 Figure/Table 图表 |
| **典型表现** | 图里同时出现：页眉/页码、大段正文段落、**多个 Figure**、双栏另一栏文字 |
| **如何查** | 打开 `note.pdf` 该插图 → 与 `source.pdf` 同页对比：若插图高度/内容与**整页**相近，或可见页码与正文流式段落，即 **FAIL** |
| **如何查源文件** | 打开 `images/figure_N.jpg`：若宽高比接近 A4/Letter 页且含大量文字段落 → **FAIL** |
| **修复** | 删除错误整页图 → 按 §1.3.4 **仅 clip Figure 区域** 重裁 → 更新 `note.md` 路径 → Step 6 → 再 Step 7 |

##### 问题 ②：Figure 裁切不全（边缘信息丢失）

| 项目 | 说明 |
|------|------|
| **是什么** | 只裁到了 Figure 的一部分，原论文图边缘内容被切掉 |
| **典型表现** | 分类图/流程图**左侧竖排标签**缺失、图例被切、箭头/色块贴边被截断、子图只露出一半 |
| **如何查** | `note.pdf` 该图与 `source.pdf` **同 Figure 并排**：任一侧标签、图例、箭头在笔记图里缺失而原论文里有 → **FAIL** |
| **高发 Figure** | 多子图、taxonomy 树、带大量 text 标签的示意图（如 Figure 3/4/5/7 类）须**重点核对四边** |
| **修复** | 按 §1.3.4 重算边界：**drawings + text + embedded 并集**，加 2–5% padding → 覆盖 `images/` 中该文件 → 必要时改 `note.md` → Step 6 → 再 Step 7 |

##### 自检记录（建议，便于多轮修复）

对每张原图在心里或简要记下：`Figure N | B1整页 PASS/FAIL | B2裁切 PASS/FAIL | 备注`

**仅当全部原图 B1=PASS 且 B2=PASS**，且 §7.3 文字与其它项通过，才可交付。

#### 7.3 其它检查项

| 类别 | 检查内容 | 不合格表现 |
|------|----------|------------|
| **文字** | 标题、正文、表格中文可读 | 方块、乱码、「锟斤拷」、空白 |
| **文字** | 与 `note.md` 语义一致 | PDF 与 MD 内容明显不符 |
| **图片 B1** | **非整页**（§7.2 问题①） | 含页眉、页码、大段正文、同图多 Figure |
| **图片 B2** | **边缘完整**（§7.2 问题②） | 竖排标签、图例、箭头、子图边缘被切掉 |
| **图片 B3** | 内容为**原论文图表** | 乱图、无关截图、错绑 Figure |

`assets/` 中的 AI 示意图：仅核对是否正常显示且标注「AI 生成示意图」，不要求与论文原图一致。

#### 7.4 如何执行（Agent 工具）

1. **打开双 PDF**：`note.pdf`（成品）与 `source.pdf`（原论文）
2. **读正文**：抽查中文是否乱码（检查 A）
3. **逐 Figure 做 B1+B2**：在 `note.pdf` 定位每张原图 → 在 `source.pdf` 打开同 Figure → **并排对比**是否整页、是否缺边
4. **复核源文件**：对 B1/B2 可疑项，再打开 `images/` 对应文件确认
5. **判定**：全部 PASS 才可进入 §7.6 交付；B1/B2 FAIL 必须走 §7.5 修复，**禁止**先交付再改

#### 7.5 不通过时：查因与修复

| 现象 | 可能原因 | 修复（按优先级） |
|------|----------|------------------|
| PDF 乱码、`note.md` 正常 | PDF 转换未嵌入中文 | **只重做 Step 6**：换方式 A 浏览器打印；**禁止**重写三阶段笔记 |
| PDF 乱码、`note.md` 也乱 | 文件编码错误 | 用 UTF-8 重写 `note.md`，再 Step 6 → Step 7 |
| 乱图 / 非论文图 | Step 1 提取错绑或未对齐 Figure | 回到 Step 1 §1.3.4 重裁原图，修正 `note.md`，再 Step 6 → Step 7 |
| **B1 整页当 Figure 图** | 整页渲染无 clip、偷懒截页 | §7.2 问题①：删整页图 → §1.3.4 区域重裁 → 更新 `note.md` → Step 6 → Step 7 |
| **B2 Figure 边缘被切** | 边界只含 drawings、漏 text | §7.2 问题②：union 边界 + padding 重裁 → 覆盖 `images/` → Step 6 → Step 7 |
| Figure 编号错 | catalog 与文件不一致 | 修正 `images/` 与 `note.md` 引用，再 Step 6 → Step 7 |
| 图片缺失 / 空白 | 路径错误或文件未嵌入 PDF | 修复路径，换 Step 6 转换方式（确保 `--resource-path` 或 HTML 相对路径正确） |
| AI 图冒充原图 | 误用 `assets/` 或错路径 | 改回 `images/` 论文原图，再 Step 6 → Step 7 |

修复后**必须**更新 `images/`（及必要时 `note.md`）→ **重新 Step 6 生成 PDF** → **完整重做 Step 7（含 §7.2 两项）**，直至通过。3 轮仍失败须向用户说明哪几张 Figure 无法修复。

> **仅图片 B1/B2 失败时**：修复路径**仅限** §1.3.4 重裁 → Step 6 → Step 7；**禁止**重做 Step 2 联网或 Step 5 三阶段（除非 `note.md` 文字本身也需改）。

#### 7.6 交付

**仅当 Step 7 自检全部通过后**：

```bash
{论文简称}_yanxi_note.pdf
send_file_to_user <PDF绝对路径>
```

**MUST NOT**：

- 未做 §7.2 **B1/B2 两项**图片自检即交付
- 已知 **整页当图** 或 **裁切不全** 仍 `send_file_to_user`
- 仅发送 `note.md`（除非用户明确要求 Markdown）

**✅ Checkpoint — 自检通过，PDF 已交付。流程结束。**

---

## 配图 Prompt 规范（文生图，可选）

仅在原图不够直观时生成。固定 **16:9** 横构图。

提示词须为**连贯中文段落**（建议 600–1500 字），按此结构组织：

1. **整体概览**：主标题（双引号写出）、副标题、风格（扁平矢量插画、色彩明快）、背景色、主辅色、构图
2. **模块描述**：各区块位置、模块标题与正文（双引号逐字写出）、图标与数据（数值须具体）
3. **连接与导航**：箭头、虚线、流程方向
4. **装饰与氛围**：背景纹理、阴影等

**图内文字规则**：每一处图内文字用中文双引号 `""` 包裹并逐字写出。

**图类型选型**：

| 内容类型 | 推荐图类型 |
|----------|------------|
| 模型/网络结构 | 模型架构图，模块分层，箭头表数据流 |
| 算法步骤 | 算法流程图，矩形步骤 + 菱形判断 |
| 方法对比 | 左右并列对比图，差异高亮 |
| 原理机制 | 中心机制 + 输入输出因果箭头 |
| 系统流水线 | 多阶段方框左→右连接 |
| 公式推导 | 教学板书图，黑板背景分步展示 |
| 通用要点 | 学术信息图，3–5 分区各含图标与标签 |

---

## Failure Recovery

| 失败场景 | 处理 |
|----------|------|
| **PaddleOCR 安装失败** | 改 **Kreuzberg**（§1.3.2）；仍须 Figure 对齐 + 三阶段 |
| **PaddleOCR 超时** | 停止等待，改 **Kreuzberg**；向用户简要说明已降级 |
| **PaddleOCR + Kreuzberg 均失败** | Agent 逐页读 PDF + 按 §1.3.4 手动裁 Figure；**仍须执行三阶段** |
| **整页截图 / 裁切不全** | 按 §1.3.4 重裁；union 边界含 text+drawings+嵌入图 |
| 配图与 Figure 编号不一致 | 回到 Step 1 §1.7 重提；修正 `note.md` 后 Step 6 → Step 7 |
| **Step 7：PDF 文字乱码** | `note.md` 正常则只重做 Step 6；`note.md` 也乱则 UTF-8 重写后再转 PDF |
| **Step 7：B1 整页当 Figure 图** | §7.2 问题① → §1.3.4 区域重裁 → Step 6 → 完整 Step 7 |
| **Step 7：B2 裁切不全 / 边缘丢失** | §7.2 问题② → union+padding 重裁 → Step 6 → 完整 Step 7 |
| **Step 7：PDF 内乱图/错图** | 回 Step 1 重提原图或修正 `note.md` → Step 6 → 再 Step 7 |
| PaddleOCR / Kreuzberg 正文仍不可读 | Agent 逐页阅读 `source.pdf`；禁止将乱码 skeleton 传入三阶段 |
| Agent Reach 不可用 | 用 `web_search`；启用 Step 4 联网关闭 System |
| 笔记 LLM | 锁定当前会话模型或豆包 Seed，禁止换模型 |
| PDF 转换失败 | 换 Step 6 其他方式；最后 zip 交付 |

---

## 质量检查清单

- [ ] Step 1 已用 PaddleOCR 或 Kreuzberg 产出 `parsed.md`，且 **§1.3.4 裁剪通过**（非整页、边缘完整）
- [ ] 六章结构齐全
- [ ] 每张原图已绑定 Figure/Table 编号，catalog 为 Web 端格式
- [ ] 已从 `note.md` 生成 `note.pdf`，且文件头为 `%PDF`
- [ ] **Step 7 §7.2**：全部原图 B1（非整页）、B2（边缘完整）均为 PASS
- [ ] **Step 7**：PDF 正文中文正常；无乱图/错绑 Figure
- [ ] 已用 `send_file_to_user` 交付 `{论文简称}_yanxi_note.pdf`（自检通过后）

---

## 触发词与示例

**触发词**：研析、yanxi、解读论文、论文笔记、研析笔记、生成论文解读

**用户示例**：

> 用研析解读 `D:/papers/transformer.pdf`，把 PDF 笔记发给我

（上例中 `D:/papers/transformer.pdf` 即 **`source.pdf`**——待解读的原论文；Agent 产出为 `{简称}_yanxi_note.pdf`。）

**Agent 执行摘要**：

1. Step 1：**PaddleOCR** 解析 PDF（失败/超时 → **Kreuzberg**）→ Figure 对齐 → `parsed.md` + `images/`
2. Step 5：三阶段写笔记 → `note.md`
3. Step 6：`note.md` → `note.pdf`
4. Step 7：打开 `note.pdf` + `source.pdf` → **B1 非整页、B2 边缘完整** → 通过则 `send_file_to_user`
