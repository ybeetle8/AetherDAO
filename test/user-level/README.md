# 用户等级查询测试

## 说明

测试从链上查询用户等级的两种方式：

### 方式一：`getTeamPerformanceDetails(address)` （推荐）

返回完整的等级信息：

| 字段 | 说明 |
|------|------|
| `totalTeamInvestment` | 团队投资总额（Team KPI） |
| `teamMemberCount` | 直推人数 |
| `currentTier` | **当前等级（0-9，对应 V0-V9）** |
| `nextTierThreshold` | 下一等级门槛 |
| `progressToNextTier` | 升级进度百分比 |

### 方式二：`getUserInfo(address)`

返回原始数据，需自行根据门槛计算等级：

| 字段 | 说明 |
|------|------|
| `totalStaked` | 个人质押总额 |
| `teamKPI` | 团队 KPI |
| `referrer` | 推荐人地址 |
| `hasLockedReferral` | 是否已绑定推荐人 |
| `isPreacherStatus` | 是否为布道者（质押 >= 200 USDX） |

### 等级计算规则

最终等级 = min(个人质押等级, 团队 KPI 等级)，双维度取低。

## 运行

```bash
npx hardhat run test/user-level/user-level.test.js --network localhost
```
