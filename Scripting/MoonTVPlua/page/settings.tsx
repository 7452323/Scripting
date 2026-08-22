import { Button, HStack, Image, List, SecureField, Section, Text, TextField, VStack, useState } from "scripting"
import { moonClient } from "../client"
import { ACCENT } from "../design"

export default function SettingsView() {
  const [username, setUsername] = useState(moonClient.getSavedUsername() || "")
  const [password, setPassword] = useState("")
  const [regPassword2, setRegPassword2] = useState("")
  const [baseUrl, setBaseUrl] = useState(moonClient.getBaseUrl())
  const [status, setStatus] = useState("")
  const [loading, setLoading] = useState(false)
  const [loggedIn, setLoggedIn] = useState(moonClient.isLoggedIn())
  const [showRegister, setShowRegister] = useState(false)

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) { setStatus("请输入账号和密码"); return }
    setLoading(true); setStatus("登录中...")
    try {
      await moonClient.login(username.trim(), password)
      setLoggedIn(true); setStatus("登录成功"); setPassword(""); setShowRegister(false)
    } catch (e: any) { setStatus(e.message || "登录失败") }
    setLoading(false)
  }

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) { setStatus("请输入账号和密码"); return }
    if (password !== regPassword2) { setStatus("两次密码不一致"); return }
    setLoading(true); setStatus("注册中...")
    try {
      await moonClient.register(username.trim(), password)
      try { await moonClient.login(username.trim(), password); setLoggedIn(true); setStatus("注册成功，已自动登录") }
      catch { setStatus("注册成功，请手动登录") }
      setPassword(""); setRegPassword2(""); setShowRegister(false)
    } catch (e: any) { setStatus(e.message || "注册失败") }
    setLoading(false)
  }

  const handleRefreshLogin = async () => {
    setLoading(true)
    setStatus("正在检查登录状态...")
    try {
      const result = await moonClient.refreshLogin()
      setLoggedIn(true)
      setStatus(result === "relogged" ? "登录已失效，已自动重新登录" : "登录状态有效")
    } catch (e: any) {
      setLoggedIn(moonClient.isLoggedIn())
      setStatus(e.message || "检查登录状态失败")
    }
    setLoading(false)
  }

  const handleLogout = async () => {
    setLoading(true)
    try { await moonClient.logout(); setLoggedIn(false); setStatus("已退出登录") }
    catch { setLoggedIn(false) }
    setLoading(false)
  }

  const handleSaveUrl = () => {
    const url = baseUrl.trim().replace(/\/$/, "")
    if (url) { moonClient.setBaseUrl(url); setStatus("服务器地址已保存") }
  }

  return (
    <List
      navigationTitle="设置"
      navigationBarTitleDisplayMode="large"
    >
      {/* Account Section */}
      <Section>
        {loggedIn ? (
          <>
            <VStack
              padding={{ vertical: 20, horizontal: 16 }}
              frame={{ maxWidth: "infinity" }}
            >
              <Image
                systemName="person.crop.circle.fill"
                foregroundStyle={ACCENT}
                font="title"
                padding={{ bottom: 8 }}
              />
              <Text font="title3" fontWeight="bold">{moonClient.getSavedUsername()}</Text>
              <Text foregroundStyle="secondaryLabel" font="subheadline" padding={{ top: 4 }}>已登录</Text>
            </VStack>
            <Button
              title={loading ? "正在刷新..." : "刷新登录状态"}
              action={handleRefreshLogin}
            />
            <Button
              title="退出登录"
              tint="systemRed"
              action={handleLogout}
            />
          </>
        ) : showRegister ? (
          <>
            <TextField
              title="用户名"
              value={username}
              prompt="请输入用户名"
              onChanged={(value: string) => setUsername(value)}
              autofocus
            />
            <SecureField
              title="密码"
              value={password}
              prompt="请输入密码"
              onChanged={(value: string) => setPassword(value)}
            />
            <SecureField
              title="确认密码"
              value={regPassword2}
              prompt="请再次输入密码"
              onChanged={(value: string) => setRegPassword2(value)}
            />
            <Button
              title={loading ? "注册中..." : "注册"}
              tint={ACCENT}
              action={handleRegister}
            />
            <Button
              title="已有账号？返回登录"
              action={() => {
                setShowRegister(false)
                setRegPassword2("")
                setStatus("")
              }}
            />
          </>
        ) : (
          <>
            <TextField
              title="用户名"
              value={username}
              prompt="请输入用户名"
              onChanged={(value: string) => setUsername(value)}
            />
            <SecureField
              title="密码"
              value={password}
              prompt="请输入密码"
              onChanged={(value: string) => setPassword(value)}
            />
            <Button
              title={loading ? "登录中..." : "登录"}
              tint={ACCENT}
              action={handleLogin}
            />
          </>
        )}

        {!loggedIn && !showRegister ? (
          <Button
            title="注册账号"
            action={() => { setShowRegister(true); setStatus("") }}
          />
        ) : null}
      </Section>

      {status ? (
        <Section>
          <Text
            foregroundStyle={status.includes("失败") ? "systemRed" : status.includes("成功") ? "systemGreen" : "secondaryLabel"}
            font="subheadline"
          >
            {status}
          </Text>
        </Section>
      ) : null}

      {/* Server Section */}
      <Section>
        <TextField
          title="服务器地址"
          value={baseUrl}
          prompt="https://moon.1314k.eu.org"
          onChanged={(value: string) => setBaseUrl(value)}
        />
        <Button
          title="保存"
          action={handleSaveUrl}
        />
      </Section>

      {/* Important Notice */}
      <Section>
        <VStack spacing={10} padding={{ vertical: 12 }} frame={{ maxWidth: "infinity" }}>
          <Text font="headline" fontWeight="semibold">重要声明</Text>
          <Text foregroundStyle="secondaryLabel" font="footnote">
            本项目仅供学习和个人使用
          </Text>
          <Text foregroundStyle="secondaryLabel" font="footnote">
            请勿将部署的实例用于商业用途或公开服务
          </Text>
          <Text foregroundStyle="secondaryLabel" font="footnote">
            如因公开分享导致的任何法律问题，用户需自行承担责任
          </Text>
          <Text foregroundStyle="secondaryLabel" font="footnote">
            项目开发者不对用户的使用行为承担任何法律责任
          </Text>
          <Text foregroundStyle="secondaryLabel" font="footnote">
            本项目不在中国大陆地区提供服务。如有该项目在向中国大陆地区提供服务，属个人行为。在该地区使用所产生的法律风险及责任，属于用户个人行为，与本项目无关，须自行承担全部责任。特此声明
          </Text>
        </VStack>
      </Section>
    </List>
  )
}
