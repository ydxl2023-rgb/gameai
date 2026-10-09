# GameAI 协作平台

- `src/GameAI.Cli`：独立 C# CLI，不依赖 Unity。
- `src/GameAI.Server`：云端编排与 Track。
- `plugins/gameai-track`：Codex 插件与 UI。
- `skills`：独立角色技能。

启动方式、路径配置与迁移边界见 [平台目录说明](docs/platform-layout.md)。

## 原 Unity 示例工程
Unity tool to procedurally generate 'infinite' worlds based on different levels of perlin noise. You can choose the amount of biomes you want to create as well as its characteristics (height, probability) and the assets to populate them (ground textures, trees, rocks and billboard grass).
