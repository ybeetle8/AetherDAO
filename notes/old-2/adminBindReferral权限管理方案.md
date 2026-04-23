# adminBindReferral 权限管理方案

## 当前权限机制

`adminBindReferral` 和 `batchAdminBindReferral` 使用 `onlyOwner` 修饰符，即合约部署者地址。

## 丢弃权限的两种方式

### 方式一：renounceOwnership（放弃全部管理权）

Ownable 自带的方法，调用后 owner 变为零地址：

```solidity
renounceOwnership();
```

影响范围 — 以下函数全部失效：
- `adminBindReferral` / `batchAdminBindReferral`
- `setRootAddress`
- `setAE`
- `setFeeRecipient`
- `reset7DayStakeUsage` / `batchReset7DayStakeUsage`
- 所有其他 `onlyOwner` 函数

适用场景：合约完全稳定，不再需要任何管理操作。

### 方式二：加开关（只禁用 adminBind，保留其他管理权）

新增一个不可逆开关：

```solidity
bool public adminBindEnabled = true;

function disableAdminBind() external onlyOwner {
    adminBindEnabled = false;
}
```

在 `adminBindReferral` 和 `batchAdminBindReferral` 开头加：

```solidity
require(adminBindEnabled, "Admin bind disabled");
```

迁移完成后调用 `disableAdminBind()`，仅关闭管理员绑定推荐人的能力，其他管理功能不受影响。

## 建议

用方式二。迁移完数据后调 `disableAdminBind()` 即可，其他管理功能保留以备后续运营需要。
