# AE-Staking 与 AetherReferral 关系分析

## 结论

两个合约**没有任何直接交互**——不互相引用、不共享接口、不存在跨合约调用。但它们各自独立实现了高度相似的推荐人(Referral)系统。

`AetherReferral` 看起来是从 `StakingBase` 中提取并重构的独立推荐人管理合约，增加了多项改进，但尚未与质押系统集成。

---

## 重复的推荐人功能对比

| 功能 | StakingBase.sol | AetherReferral.sol |
|---|---|---|
| 推荐人映射 | `_referrals` (line 141) | `_referrals` (line 69) |
| 下级列表 | `_children` (line 142) | `_children` (line 72) |
| 锁定状态 | `_hasLocked` (line 143) | `_hasLockedReferral` (line 75) |
| 根地址 | `rootAddress` (line 117) | `rootAddress` (line 63) |
| 最大深度 | `MAX_REFERRAL_DEPTH = 30` (line 67) | `MAX_REFERRAL_DEPTH = 30` (line 84) |
| 绑定推荐人 | `lockReferral(address)` (line 403) | `lockReferral(address)` (line 107) |
| 查询推荐人 | `getReferral(address)` (line 803) | `getReferral(address)` (line 171) |
| 查询推荐链 | `getReferrals(address, uint8)` (line 710) | `getReferrals(address, uint8)` (line 208) |
| 是否已绑定 | `isBindReferral(address)` (line 807) | `hasLockedReferral(address)` (line 189) |
| 下级数量 | `getReferralCount(address)` (line 481) | `getChildrenCount(address)` (line 203) |

---

## AetherReferral 独有的改进

- **循环引用检测**: `_wouldCreateCircularReference()` — StakingBase 没有此检查
- **推荐人验证**: 要求推荐人自身已绑定才能被引用（rootAddress 除外）
- **好友系统**: `_friends` 映射、`lockFriend()`、`getFriend()` — 完全独立的关系类型
- **Operator 角色**: 支持 owner 之外的第二管理员
- **管理员绑定**: `adminBindReferral()`、`adminBindFriend()` — 管理员可代用户绑定
- **批量查询**: `batchGetUserInfo()` 支持批量查询用户信息
- **带深度的链查询**: `getReferralChainWithDepth()` 同时返回地址和深度

## StakingBase 独有的功能（与推荐人相关）

- **团队投资追踪**: `teamTotalInvestValue`，质押时沿推荐链向上累加投资额
- **奖励分发**: `_distributeFriendReward()`、`_distributeTeamReward()` — 通过推荐链分发 USDT 奖励
- **布道者判定**: `isPreacher()` — 判断用户质押是否达到布道者门槛
- **等级系统**: `_getUserTier()` — 基于团队 KPI 和个人质押的等级体系

---

## 当前状态

- 两个合约维护**完全独立的推荐人状态**
- 部署脚本中没有任何将两者关联的代码
- 如果要用 `AetherReferral` 替换 `StakingBase` 内置的推荐人逻辑，需要修改质押合约，改为从 `AetherReferral` 读取推荐人数据
