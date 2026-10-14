"""AES_V3 稀疏位层 (38.7.0) — sum_data / mix_columns

来源: libmetasec_ml.so 38.7.0 反汇编逐条解码 + unidbg 直测 (2026-10-08, 3 run)
  sum_data    = so+0x2a41c4   (byte -> qword 散布)
  mix_columns = so+0x2a4034   (qword -> byte 收集)
两者互为逆运算，位映射 8/8 逐条对上。

映射 (r = 旋转计数, 每处理 1 字节 +1, 走满 0..7 后函数返回):
  src_bit0 -> qw[5] 位 ((r-1)&7)      src_bit4 -> qw[6] 位 ((r+1)&7)
  src_bit1 -> qw[0] 位 ((r+6)&7)      src_bit5 -> qw[7] 位 (r&7)
  src_bit2 -> qw[4] 位 ((r+2)&7)      src_bit6 -> qw[3] 位 ((r+4)&7)
  src_bit3 -> qw[2] 位 ((r+3)&7)      src_bit7 -> qw[1] 位 ((r+5)&7)

`qwords` = 循环周期 = **key 缓冲区容量 // 8**，与 `len(data)` 无关:
  真机 w1 = 795 → qwords = 99；而 len(data) = 31，故单次调用内 r 恒为 0、qi == i。
  ⚠️ 旧默认 `ceil(len(data)/8)` 是错的: 31B 时给 4，逐位只对上 139/248。

真机语义 (选择性位写，非 `|=`):
  sum_data 对每个源位做 `out[idx] = (out[idx] & ~(1<<lane)) | (bit<<lane)`，
  且**不预先清零**缓冲区 —— 其余位是堆垃圾(T)，每 run 都不同。
  mix_columns 只读回那些 lane，故 T 不参与结果。
  从零起点看等价于 `|=`（仓库旧模型），这是它此前能对上的原因。
"""

BIT_MAP = {
    0: (5, -1),
    1: (0, 6),
    2: (4, 2),
    3: (2, 3),
    4: (6, 1),
    5: (7, 0),
    6: (3, 4),
    7: (1, 5),
}


def _walk(nbytes, qwords):
    """产出 (byte_index, r, qword_index) —— 与汇编循环一致。

    汇编: w10 每字节 +8, 当 w10+16 > w1 时 w10 归零且 r+1;
    r+1 > 7 时函数返回 (即单次最多处理 8*qwords 字节)。
    w1 是 **key 缓冲区容量(字节)**，不是 len(data)。
    """
    for i in range(nbytes):
        if i >= 8 * qwords:
            break
        yield i, i // qwords, i % qwords


def sum_data(data, qwords=None, base=None):
    """散布: data 的位 -> qword 数组的位。

    qwords: 循环周期 (= key 缓冲区容量 // 8)。None = 无回绕 (= len(data))，
            与真机 (w1 远大于 8*len(data)) 一致。
    base:   预置缓冲区；None = 全零。给定 base 时按真机的选择性位写语义。
    """
    if qwords is None:
        qwords = max(1, len(data))
    out = bytearray(qwords * 8) if base is None else bytearray(base)
    for i, r, qi in _walk(len(data), qwords):
        src = data[i]
        for b in range(8):
            qb, k = BIT_MAP[b]
            lane = (r + k) & 7
            idx = qi * 8 + qb
            if idx >= len(out):
                break
            out[idx] = (out[idx] & ~(1 << lane)) | (((src >> b) & 1) << lane)
    return bytes(out)


def mix_columns(data, key, qwords=None):
    """收集: qword 数组的位 -> 覆写 data 的对应字节。返回新字节串。"""
    if qwords is None:
        qwords = max(1, len(data))
    out = bytearray(data)
    for i, r, qi in _walk(len(data), qwords):
        val = 0
        for b in range(8):
            qb, k = BIT_MAP[b]
            lane = (r + k) & 7
            if (key[qi * 8 + qb] >> lane) & 1:
                val |= 1 << b
        out[i] = val
    return bytes(out)


def _selfcheck():
    """散布后再收集应还原原 data 中参与映射的位。"""
    import os
    data = os.urandom(31)
    qw = sum_data(data)
    back = mix_columns(bytes(31), qw)
    return data, back


if __name__ == "__main__":
    import os
    d = os.urandom(31)
    q = sum_data(d)
    b = mix_columns(bytes(31), q)
    print("data :", d.hex())
    print("back :", b.hex())
    print("bits_equal:", all(bin(d[i] ^ b[i]).count("1") == 0 for i in range(31)))
