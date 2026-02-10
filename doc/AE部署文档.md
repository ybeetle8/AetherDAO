部署合约

npx hardhat run scripts/deployAE.js --network localhost
测试部署

npx hardhat run scripts/testAE.js --network localhost
一键编译-部署-测试

npx hardhat compile && \
npx hardhat run scripts/deployAE.js --network localhost && \
npx hardhat run scripts/testAE.js --network localhost


代币分配
接收方	数量	百分比
Staking 储备	1,500,000 AE	15%
流动性池	4,000,000 AE	40%
测试钱包	100,000 AE	1%
部署者	4,400,000 AE	44%
总计	10,000,000 AE	100%



脚本已生成以下地址（写入配置文件）：
Marketing Address: 0x1234567890123456789012345678901234567890
Root Address: 0x2345678901234567890123456789012345678901
Fee Recipient: 0x3456789012345678901234567890123456789012


