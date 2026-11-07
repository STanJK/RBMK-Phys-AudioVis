# RBMK-Phys-AudioVis

[English](README.md) | **简体中文**

一个以 RBMK 控制棒阵列为视觉原型、后来被魔改成刚体事故沙盒的音频可视化小玩具。

> “以切尔诺贝利反应堆堆芯的控制棒阵列为视觉原型的实时音频可视化实验。”
>
> —— 原项目 README，Andy Wang / [wzk112](https://github.com/wzk112)

本项目基于 **Andy Wang（wzk112）** 的 MIT 开源项目
[reactor-audio-visualizer](https://github.com/wzk112/reactor-audio-visualizer)。

原项目建立了核心创意和交互方式：使用浏览器 Web Audio API 分析音频，将频率按“中心低频、外圈高频”的方式映射到 709 根控制棒上，并提供演示信号、本地文件、麦克风、视角控制以及灵敏度 / 平滑度 / 音量调节。

这个版本保留了这一基础，然后把它往“物理事故现场”方向推得更远。

## 这个版本增加了什么

### 真实刚体控制棒

原先的视觉升降被重做成 Rapier 3D 物理场景：

- 共 **709 根**固定长度的棒。
- 正常状态下是受导向约束的 kinematic rigid body。
- 被发射后切换为真正的 dynamic rigid body。
- 发射后受重力、摩擦、角速度、CCD 和碰撞求解影响。
- 棒可以掉回场景、撞地、撞墙，并堆积在地面上。
- 场景包含堆芯围壁、外部碰撞地面、返回地面和上方高度限制。
- “Reset Physics” 会重建整个物理世界并清空事故历史。

### 随机超调事故

随机超调默认开启。

系统会周期性选择符合条件、正在向上运动的棒并执行一套分阶段事故流程：

1. 棒从绿色逐渐加热到红色；
2. 采样当前向上速度；
3. 按倍率发射；
4. 低能量发射可以保持导向并回到原通道；
5. 一旦整根棒真正完全越过堆芯平面，该棒在本次物理会话里永久视为不可恢复。

可恢复棒会竖直落回原通道，并在 5 秒内由红色恢复为绿色。

不可恢复棒保持红色 15 秒，然后在随机 **10 ± 5 秒** 的时间里逐渐由红变灰，避免大规模事故时所有棒同步冷却。

### AZ5 灾难模式

这里的 AZ5 **不是**现实反应堆 SCRAM 的物理模拟。

在这个玩具里，AZ5 会启动一段 5 秒的升级过程：

- 仍符合资格的棒从绿变红；
- 有效响应逐步拉到最大灵敏度；
- 5 秒内临时绕过正常的导向高度上限；
- 5 秒后，把**历史上从未完全飞出过堆芯**的棒切换成 Dynamic 并发射；
- 发射速度根据当时的向上运动计算，同时设置最低发射速度；
- AZ5 后上方围壁会被取消，直到重置物理世界。

只有当**整根棒的底端也越过 Y=0 堆芯平面**后，才会被记为“已经完全发射出去过”。

因此，只是超调了一截、没有完全离开堆芯、后来又回落的棒，之后仍然可以参加 AZ5。

### Beat / BPM 驱动的地面震动

AZ5 还会开启随音乐 beat 震动的地面。

最早版本只盯两个低频 FFT 柱。现在改成了一个非常轻量的 beat tracker：

- 低频 positive spectral flux；
- 中频 positive spectral flux；
- 全频 positive spectral flux；
- 对低频可视化柱额外做 kick 权重；
- 保存滚动 onset envelope；
- 用短窗口 autocorrelation 粗估 BPM；
- 用 phase predictor 在弱拍之间维持节拍网格。

地面本身是一个 kinematic Rapier body，所以 beat 触发时移动的是**真实碰撞面**，而不是单纯做镜头抖动。

当前最大震动位移：

- 垂直：**1.15 units**
- 横向：**0.275 units**

### 碰撞预算与性能降级

数百根 Dynamic 长方体同时互撞非常昂贵，所以现在有两级碰撞降级。

**第一层：棒-棒碰撞上限**

- 大规模发射后，最多只保留总棒数一半的棒-棒碰撞。
- 709 根棒中，最多 **354 根**继续参与棒-棒碰撞。
- 超出的棒随机切换为“只碰环境”。
- 它们仍然会碰：
  - 地面；
  - 围壁；
  - 返回地面；
  - 上方高度限制。

这个限制在 AZ5 的**第一个 Dynamic 物理步之前**就应用，避免先让 709 根棒互撞一帧再降级造成瞬时性能尖峰。

**第二层：远景完整碰撞预算**

- 完整实时碰撞预算为总棒数的四分之一，即 **177 根**。
- 超过预算后，只从距离核心超过约 **1.5× 围壁半径**的远景棒中选候选。
- 候选会随机进一步关闭碰撞。
- 即使碰撞被关闭，棒仍保持渲染和刚体运动。
- 被完全裁剪的远景棒同时关闭 CCD。

这样可以尽量保住核心附近最有视觉价值的碰撞，把远景精度作为性能预算牺牲掉。

### Bilibili 音频输入

Bilibili 是默认音频源。

浏览器仍然**不会直接调用 Bilibili 的 playurl / WBI API**。解析改成“直连优先 + Cloudflare fallback”：

1. 浏览器先直连 Squidtail Bili2VRC 解析接口；
2. 直连请求设置 **10 秒硬超时**；
3. 网络错误、CORS、API 错误会立即 fallback；如果只是一直卡住，则 10 秒后 fallback；
4. 如果直连解析成功，优先尝试返回的 CDN 媒体地址，同时提前生成一个 Worker `/stream` 地址作为媒体 fallback；
5. 如果直连解析失败，则浏览器请求 Cloudflare Worker 的 `/resolve`；
6. Worker 从 Cloudflare 网络连接 Squidtail，拿到媒体地址、校验 CDN host，然后返回受限的 `/stream` 代理地址。

因此，能直连 Squidtail 的网络走最短路径；国内或其他无法稳定连接解析服务器的网络，则自动切到 Cloudflare 中转解析。

Worker 只允许已知 Bilibili CDN host，不作为通用 HTTP 代理。

生产 Worker：

```text
https://rbmk-bili-audio-proxy.stanjk24.workers.dev
```

上游解析器：

```text
https://api.squidtail.com/bili2vrc/parse/
```

界面里还带有一个很小的默认测试歌单，方便直接点进去玩。

### 轻量响度归一化

Bilibili 和本地文件音频在进入主频谱分析之前，会先经过一个极简自动增益阶段。

没有引入完整 LUFS 算法，而是用平滑 RMS 作为便宜的响度代理：

- 目标：约 **-16 dBFS RMS**
- 平滑窗口：约 **3 秒**
- 静音门：**-35 dB**
- deadband：**±1 dB**
- 最大增益：**+8 dB**
- 最大衰减：**-12 dB**
- 大声时压低更快，小声时抬升更慢

归一化节点位于主 AnalyserNode 之前，因此听到的音量、709 根棒的响应以及 beat detector 使用的是同一份归一化后信号。

## 当前技术栈

- React 19
- TypeScript
- Vite
- Web Audio API
- Three.js / React Three Fiber
- `@react-three/rapier`
- Cloudflare Workers
- GitHub Actions
- GitHub Pages

## 本地开发

```bash
npm install
npm run dev
```

## CI

```bash
npm run typecheck
npm run build
```

## 原作者与许可证

原项目：

- **Reactor Audio Visualizer**
- 作者：**Andy Wang / wzk112**
- 仓库：https://github.com/wzk112/reactor-audio-visualizer
- 许可证：MIT

本仓库在原项目基础上包含大量新增代码和功能修改。

第三方版权和许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 声明

这是一个音频可视化玩具和物理沙盒。

它**不是**反应堆模拟器，不是安全分析模型，不是中子学模型，不是热工水力模型，也不代表真实 RBMK 事故行为。

按钮上写着 **AZ5**，并不意味着这个项目具有任何工程严肃性。
