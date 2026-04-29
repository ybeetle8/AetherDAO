# BscScan API Key 申请指南

## 前提条件

- 已注册 BscScan 账号并完成邮箱验证
- 已登录 BscScan（https://bscscan.com）

## 申请步骤

### 第一步：进入 API Key 管理页面

登录后，有两种方式进入：

- **方式 A**：直接访问 https://bscscan.com/myapikey
- **方式 B**：点击页面右上角的用户名 → 下拉菜单中选择 **"API Keys"**

### 第二步：创建新的 API Key

1. 在 API Keys 页面，点击 **"+ Add"** 按钮
2. 在弹出框中输入一个描述名称（App Name），例如：`AetherDAO` 或 `SYI-Deploy`
3. 点击 **"Create New API Key"** 确认

### 第三步：复制并保存 API Key

- 创建成功后，页面会显示你的 API Key（一串字母数字组合）
- **立即复制并安全保存**，后续部署验证合约时需要用到

### 第四步：配置到项目中

将获取到的 API Key 填入项目根目录的 `.env` 文件：

```bash
BSCSCAN_API_KEY=你的API_Key
```

确保 `.env` 已添加到 `.gitignore`，**绝对不要提交到 Git 仓库**。

## 使用说明

### 速率限制

- 免费 API Key：**每秒 5 次请求**
- 对于合约验证（verify）来说完全够用

### 在 Hardhat 中使用

`hardhat.config.js` 中配置：

```javascript
etherscan: {
  apiKey: {
    bsc: process.env.BSCSCAN_API_KEY,
    bscTestnet: process.env.BSCSCAN_API_KEY,
  }
}
```

### 验证合约命令示例

```bash
npx hardhat verify --network bsc 合约地址 构造函数参数
```

## 重要提示：Etherscan API V2 迁移

BscScan 已统一到 **Etherscan API V2** 体系下：

- 现在一个 Etherscan API Key 可以访问 60+ 条链（包括 BSC）
- 如果你未来需要多链部署，可以直接在 https://etherscan.io 注册获取统一 Key
- 请求时通过 `chainid` 参数指定目标链即可

**但对于当前 BSC 主网部署，直接在 BscScan 申请的 Key 完全可用。**

## 常见问题

### Q: API Key 创建后多久生效？
A: 通常即时生效，可以立即用于合约验证。

### Q: 免费 Key 有什么限制？
A: 每秒 5 次请求限制，每日无硬性上限。对于开发和合约验证场景足够。

### Q: 一个账号可以创建多少个 Key？
A: 免费账号最多可创建 3 个 API Key。

## 参考资料

- [BscScan API Key 官方说明](https://info.bscscan.com/myapikey/)
- [BscScan API 文档](https://docs.bscscan.com/)
- [Etherscan API V2 多链迁移说明](https://docs.etherscan.io/v2-migration)
