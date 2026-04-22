// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AetherReferral - 推荐关系管理合约
 * @notice 独立的推荐关系管理合约,用于管理用户的推荐人和好友关系
 * @dev 支持推荐链查询、关系绑定和批量查询
 */
contract AetherReferral is Ownable {
    // =========================================================================
    // EVENTS
    // =========================================================================

    event ReferralBound(
        address indexed user,
        address indexed referrer,
        uint256 timestamp
    );

    event FriendBound(
        address indexed user,
        address indexed friend,
        uint256 timestamp
    );

    event OperatorUpdated(
        address indexed oldOperator,
        address indexed newOperator,
        uint256 timestamp
    );

    event AdminReferralBound(
        address indexed user,
        address indexed referrer,
        address indexed admin,
        uint256 timestamp
    );

    event AdminFriendBound(
        address indexed user,
        address indexed friend,
        address indexed admin,
        uint256 timestamp
    );

    // =========================================================================
    // ERRORS
    // =========================================================================

    error AlreadyBound();
    error CannotBindSelf();
    error InvalidAddress();
    error CircularReference();
    error NotAuthorized();

    // =========================================================================
    // STATE VARIABLES
    // =========================================================================

    /// @notice 根地址(默认推荐人)
    address public rootAddress;

    /// @notice 操作员地址(可以管理绑定关系)
    address public operator;

    /// @notice 用户 => 推荐人
    mapping(address => address) private _referrals;

    /// @notice 推荐人 => 下线列表
    mapping(address => address[]) private _children;

    /// @notice 用户是否已绑定推荐人
    mapping(address => bool) private _hasLockedReferral;

    /// @notice 用户 => 好友
    mapping(address => address) private _friends;

    /// @notice 用户是否已绑定好友
    mapping(address => bool) private _hasLockedFriend;

    /// @notice 最大推荐链深度
    uint8 public constant MAX_REFERRAL_DEPTH = 30;

    // =========================================================================
    // CONSTRUCTOR
    // =========================================================================

    constructor(address _rootAddress) Ownable(msg.sender) {
        require(_rootAddress != address(0), "Invalid root address");
        rootAddress = _rootAddress;
        operator = msg.sender; // 默认操作员为部署者

        // 标记 rootAddress 为已绑定，解决冷启动问题
        _hasLockedReferral[_rootAddress] = true;
    }

    // =========================================================================
    // EXTERNAL FUNCTIONS - Binding
    // =========================================================================

    /**
     * @notice 绑定推荐人
     * @param _referrer 推荐人地址
     */
    function lockReferral(address _referrer) external {
        address user = msg.sender;

        // 检查是否已绑定
        if (_hasLockedReferral[user]) revert AlreadyBound();

        // 检查推荐人地址
        if (_referrer == address(0)) {
            _referrer = rootAddress;
        }

        // 不能推荐自己
        if (_referrer == user) revert CannotBindSelf();

        // 推荐人必须已经绑定（除了 rootAddress）
        if (_referrer != rootAddress && !_hasLockedReferral[_referrer]) {
            revert InvalidAddress();
        }

        // 检查循环引用
        if (_wouldCreateCircularReference(user, _referrer)) {
            revert CircularReference();
        }

        // 绑定推荐关系
        _referrals[user] = _referrer;
        _children[_referrer].push(user);
        _hasLockedReferral[user] = true;

        emit ReferralBound(user, _referrer, block.timestamp);
    }

    /**
     * @notice 绑定好友
     * @param _friend 好友地址
     */
    function lockFriend(address _friend) external {
        address user = msg.sender;

        // 检查是否已绑定
        if (_hasLockedFriend[user]) revert AlreadyBound();

        // 检查好友地址
        if (_friend == address(0)) revert InvalidAddress();

        // 不能绑定自己
        if (_friend == user) revert CannotBindSelf();

        // 绑定好友关系
        _friends[user] = _friend;
        _hasLockedFriend[user] = true;

        emit FriendBound(user, _friend, block.timestamp);
    }

    // =========================================================================
    // EXTERNAL VIEW FUNCTIONS - Query
    // =========================================================================

    /**
     * @notice 获取用户的推荐人
     * @param user 用户地址
     * @return 推荐人地址
     */
    function getReferral(address user) external view returns (address) {
        return _referrals[user];
    }

    /**
     * @notice 获取用户的好友
     * @param user 用户地址
     * @return 好友地址
     */
    function getFriend(address user) external view returns (address) {
        return _friends[user];
    }

    /**
     * @notice 检查用户是否已绑定推荐人
     * @param user 用户地址
     * @return 是否已绑定
     */
    function hasLockedReferral(address user) external view returns (bool) {
        return _hasLockedReferral[user];
    }

    /**
     * @notice 检查用户是否已绑定好友
     * @param user 用户地址
     * @return 是否已绑定
     */
    function hasLockedFriend(address user) external view returns (bool) {
        return _hasLockedFriend[user];
    }

    /**
     * @notice 获取用户的推荐链
     * @param user 用户地址
     * @param maxDepth 最大深度
     * @return 推荐链地址数组(从近到远)
     */
    function getReferrals(
        address user,
        uint256 maxDepth
    ) external view returns (address[] memory) {
        if (maxDepth > MAX_REFERRAL_DEPTH) {
            maxDepth = MAX_REFERRAL_DEPTH;
        }

        address[] memory result = new address[](maxDepth);
        address current = user;
        uint256 count = 0;

        for (uint256 i = 0; i < maxDepth && current != address(0); i++) {
            current = _referrals[current];
            if (current != address(0)) {
                result[count] = current;
                count++;
            }
        }

        // 创建精确大小的数组
        address[] memory trimmed = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            trimmed[i] = result[i];
        }

        return trimmed;
    }

    /**
     * @notice 获取用户的直接下线
     * @param user 用户地址
     * @return 下线地址数组
     */
    function getChildren(address user) external view returns (address[] memory) {
        return _children[user];
    }

    /**
     * @notice 获取用户的直接下线数量
     * @param user 用户地址
     * @return 下线数量
     */
    function getChildrenCount(address user) external view returns (uint256) {
        return _children[user].length;
    }

    /**
     * @notice 分页获取用户的直接下线
     * @param user 用户地址
     * @param offset 起始索引
     * @param limit 查询数量
     * @return 下线地址数组
     */
    function getChildrenPaged(
        address user,
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        uint256 total = _children[user].length;

        if (offset >= total) {
            return new address[](0);
        }

        uint256 count = limit;
        if (offset + count > total) {
            count = total - offset;
        }

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = _children[user][offset + i];
        }

        return result;
    }

    /**
     * @notice 批量查询用户信息
     * @param users 用户地址数组
     * @return referrers 推荐人数组
     * @return friends 好友数组
     * @return hasReferrals 是否已绑定推荐人数组
     * @return hasFriends 是否已绑定好友数组
     */
    function batchGetUserInfo(
        address[] calldata users
    )
        external
        view
        returns (
            address[] memory referrers,
            address[] memory friends,
            bool[] memory hasReferrals,
            bool[] memory hasFriends
        )
    {
        uint256 length = users.length;
        referrers = new address[](length);
        friends = new address[](length);
        hasReferrals = new bool[](length);
        hasFriends = new bool[](length);

        for (uint256 i = 0; i < length; i++) {
            referrers[i] = _referrals[users[i]];
            friends[i] = _friends[users[i]];
            hasReferrals[i] = _hasLockedReferral[users[i]];
            hasFriends[i] = _hasLockedFriend[users[i]];
        }
    }

    /**
     * @notice 获取用户的完整关系信息
     * @param user 用户地址
     * @return referrer 推荐人
     * @return friend 好友
     * @return hasReferral 是否已绑定推荐人
     * @return hasFriend 是否已绑定好友
     * @return childrenCount 直接下线数量
     */
    function getUserInfo(
        address user
    )
        external
        view
        returns (
            address referrer,
            address friend,
            bool hasReferral,
            bool hasFriend,
            uint256 childrenCount
        )
    {
        return (
            _referrals[user],
            _friends[user],
            _hasLockedReferral[user],
            _hasLockedFriend[user],
            _children[user].length
        );
    }

    /**
     * @notice 获取推荐链的详细信息
     * @param user 用户地址
     * @param maxDepth 最大深度
     * @return chain 推荐链地址数组
     * @return depths 每个地址的深度
     */
    function getReferralChainWithDepth(
        address user,
        uint256 maxDepth
    )
        external
        view
        returns (address[] memory chain, uint256[] memory depths)
    {
        if (maxDepth > MAX_REFERRAL_DEPTH) {
            maxDepth = MAX_REFERRAL_DEPTH;
        }

        address[] memory tempChain = new address[](maxDepth);
        uint256[] memory tempDepths = new uint256[](maxDepth);
        address current = user;
        uint256 count = 0;

        for (uint256 i = 0; i < maxDepth && current != address(0); i++) {
            current = _referrals[current];
            if (current != address(0)) {
                tempChain[count] = current;
                tempDepths[count] = i + 1;
                count++;
            }
        }

        // 创建精确大小的数组
        chain = new address[](count);
        depths = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            chain[i] = tempChain[i];
            depths[i] = tempDepths[i];
        }
    }

    // =========================================================================
    // ADMIN FUNCTIONS
    // =========================================================================


    /**
     * @notice 设置操作员
     * @param _operator 新的操作员地址
     */
    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Invalid operator address");
        address oldOperator = operator;
        operator = _operator;
        emit OperatorUpdated(oldOperator, _operator, block.timestamp);
    }

    /**
     * @notice 管理员绑定推荐关系
     * @param user 用户地址
     * @param _referrer 推荐人地址
     */
    function adminBindReferral(
        address user,
        address _referrer
    ) external onlyOperator {
        // 检查是否已绑定
        if (_hasLockedReferral[user]) revert AlreadyBound();

        // 检查推荐人地址
        if (_referrer == address(0)) {
            _referrer = rootAddress;
        }

        // 不能推荐自己
        if (_referrer == user) revert CannotBindSelf();

        // 推荐人必须已经绑定（除了 rootAddress）
        if (_referrer != rootAddress && !_hasLockedReferral[_referrer]) {
            revert InvalidAddress();
        }

        // 检查循环引用
        if (_wouldCreateCircularReference(user, _referrer)) {
            revert CircularReference();
        }

        // 绑定推荐关系
        _referrals[user] = _referrer;
        _children[_referrer].push(user);
        _hasLockedReferral[user] = true;

        emit AdminReferralBound(user, _referrer, msg.sender, block.timestamp);
    }

    /**
     * @notice 管理员绑定好友关系
     * @param user 用户地址
     * @param _friend 好友地址
     */
    function adminBindFriend(
        address user,
        address _friend
    ) external onlyOperator {
        // 检查是否已绑定
        if (_hasLockedFriend[user]) revert AlreadyBound();

        // 检查好友地址
        if (_friend == address(0)) revert InvalidAddress();

        // 不能绑定自己
        if (_friend == user) revert CannotBindSelf();

        // 绑定好友关系
        _friends[user] = _friend;
        _hasLockedFriend[user] = true;

        emit AdminFriendBound(user, _friend, msg.sender, block.timestamp);
    }

    // =========================================================================
    // MODIFIERS
    // =========================================================================

    /**
     * @notice 只有 owner 或 operator 可以调用
     */
    modifier onlyOperator() {
        if (msg.sender != owner() && msg.sender != operator) {
            revert NotAuthorized();
        }
        _;
    }

    // =========================================================================
    // INTERNAL FUNCTIONS
    // =========================================================================

    /**
     * @notice 检查是否会产生循环引用
     * @param user 用户地址
     * @param _referrer 推荐人地址
     * @return 是否会产生循环引用
     */
    function _wouldCreateCircularReference(
        address user,
        address _referrer
    ) private view returns (bool) {
        // 如果推荐人是 rootAddress,不会产生循环
        if (_referrer == rootAddress) {
            return false;
        }

        // 检查推荐人的推荐链中是否包含 user
        address current = _referrer;
        for (uint256 i = 0; i < MAX_REFERRAL_DEPTH; i++) {
            current = _referrals[current];
            if (current == address(0)) {
                return false; // 到达链尾,没有循环
            }
            if (current == user) {
                return true; // 发现循环
            }
        }

        return false;
    }
}
