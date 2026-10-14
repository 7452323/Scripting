"""
X-Soter — 常量占位头。

番茄小说（aid=1967）真机抓包里，``X-Soter`` 三次抓包**逐字节相同**：

    00 01 00 02 00 00 ... 00        # 90 字节，后 86 字节全 0

base64 为 ``AAEAAgAAAAA...``（120 字符）。

⚠️ 同一设备的三次抓包一致，只能证明它是「非随机」的，**不能区分**
它是全 App 固定常量还是设备/安装级常量——样本都来自同一台设备。
换设备抓包才能定论。因此本模块提供的是「已知样本取值」，
不是「算法推导结果」。
"""

import base64

# 番茄小说 aid=1967 真机抓包取值：4 字节标记 + 86 个 0 = 90 字节
SOTER_MAGIC = bytes((0x00, 0x01, 0x00, 0x02))
FANQIE_SOTER = SOTER_MAGIC + bytes(86)


def make_x_soter() -> str:
    """返回已知的 X-Soter 取值（base64，120 字符）。"""
    return base64.b64encode(FANQIE_SOTER).decode()


def is_known(value: str) -> bool:
    """判断一个 X-Soter 是否与已知样本取值一致。"""
    try:
        raw = base64.b64decode(value + "=" * (-len(value) % 4))
    except Exception:
        return False
    return raw == FANQIE_SOTER
