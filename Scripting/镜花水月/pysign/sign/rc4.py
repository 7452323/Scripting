"""
RC4 cipher implementation for X-Ladon legacy.
Direct translation from armxe Mobile/cipher/RC4.py.
"""


class RC4(object):
    """
    RC4 stream cipher.
    Used for X-Ladon token generation.
    """

    def __init__(self, key: bytes):
        """
        Args:
            key: RC4 key bytes
        """
        self.table = list(range(256))
        self.index1 = 0
        self.index2 = 0
        self.key = key
        self.key_length = len(key)
        self.cipher = []
        self.secret = None

    def init(self) -> None:
        """
        Initialize the RC4 key schedule algorithm (KSA).
        """
        self.index1 = 0
        for i in range(256):
            self.index1 = (
                self.index1 + self.table[i] + self.key[i % self.key_length]
            ) % 256
            self.table[i], self.table[self.index1] = (
                self.table[self.index1],
                self.table[i],
            )
        self.index1 = 0

    def encrypt(self, secret: bytes) -> bytes:
        """
        Encrypt data with RC4 (or decrypt, since RC4 is symmetric).

        Args:
            secret: Data to encrypt

        Returns:
            Encrypted bytes
        """
        self.cipher = []
        self.secret = secret
        idx1 = self.index1
        idx2 = self.index2
        tbl = self.table[:]

        for car in self.secret:
            idx1 = (idx1 + 1) % 256
            idx2 = (tbl[idx1] + idx2) % 256
            tbl[idx1], tbl[idx2] = tbl[idx2], tbl[idx1]
            self.cipher.append(
                car ^ tbl[(tbl[idx1] + tbl[idx2]) % 256]
            )
        self.cipher = bytes(self.cipher)
        return self.cipher
