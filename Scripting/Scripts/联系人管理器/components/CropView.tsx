/**
 * CropView - iOS Contacts-style avatar crop editor
 * Features: circular crop overlay, pan, pinch zoom, slider control
 */

import { useState } from 'scripting'
import {
  NavigationStack, List, Section, Text, Image, Button, VStack, HStack, ZStack,
  MagnifyGesture, Slider, Circle
} from 'scripting'

interface CropViewProps {
  image: UIImage
  onConfirm: (croppedImage: UIImage) => void
  onCancel: () => void
}

const CROP_SIZE = 280
const MIN_SCALE = 0.5
const MAX_SCALE = 3

export function CropView({ image, onConfirm, onCancel }: CropViewProps) {
  const [scale, setScale] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  
  // 用于记录手势开始时的值，确保连续操作正确累加
  const [lastOffsetX, setLastOffsetX] = useState(0)
  const [lastOffsetY, setLastOffsetY] = useState(0)
  const [lastScale, setLastScale] = useState(1)

  const handleConfirm = () => {
    // 计算裁剪区域（圆形的外切正方形）
    const size = Math.min(image.width, image.height) / scale
    const x = (image.width - size) / 2 + offsetX / scale
    const y = (image.height - size) / 2 + offsetY / scale
    const cropped = image.croppedTo({ x, y, width: size, height: size })
    if (cropped) {
      onConfirm(cropped)
    } else {
      onCancel()
    }
  }

  const handleSliderChange = (value: number) => {
    const newScale = MIN_SCALE + (value / 100) * (MAX_SCALE - MIN_SCALE)
    setScale(newScale)
    setLastScale(newScale)
  }

  const handleReset = () => {
    setScale(1)
    setLastScale(1)
    setOffsetX(0)
    setOffsetY(0)
    setLastOffsetX(0)
    setLastOffsetY(0)
  }

  const sliderValue = ((scale - MIN_SCALE) / (MAX_SCALE - MIN_SCALE)) * 100

  return (
    <NavigationStack statusBarHidden persistentSystemOverlays="hidden">
      <List
        navigationTitle="移动和缩放"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button action={onCancel} buttonStyle="borderless">
              <Text font="subheadline" foregroundStyle="systemBlue">取消</Text>
            </Button>
          ),
          topBarTrailing: (
            <Button action={handleConfirm} buttonStyle="borderless">
              <Text font="subheadline" fontWeight="semibold" foregroundStyle="systemBlue">完成</Text>
            </Button>
          ),
        }}
      >
        <Section>
          <VStack alignment="center" padding={{ top: 20, bottom: 20 }}>
            {/* 图片 + 圆形裁剪框叠加层 */}
            <ZStack alignment="center">
              {/* 底层：可拖拽缩放的图片 */}
              <Image
                image={image}
                resizable
                frame={{ 
                  width: CROP_SIZE * scale, 
                  height: CROP_SIZE * scale 
                }}
                offset={{ x: offsetX, y: offsetY }}
                onDragGesture={{
                  minDistance: 1,
                  onChanged: (details) => {
                    setOffsetX(lastOffsetX + details.translation.width)
                    setOffsetY(lastOffsetY + details.translation.height)
                  },
                  onEnded: () => {
                    setLastOffsetX(offsetX)
                    setLastOffsetY(offsetY)
                  }
                }}
                gesture={
                  MagnifyGesture(0.05)
                    .onChanged((details: any) => {
                      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, lastScale * details.magnification))
                      setScale(newScale)
                    })
                    .onEnded(() => {
                      setLastScale(scale)
                    })
                }
              />
              
              {/* 中层：圆形遮罩，外部半透明黑色 */}
              <VStack 
                frame={{ width: CROP_SIZE, height: CROP_SIZE }}
                background="black"
                opacity={0.5}
                allowsHitTesting={false}
              />
              
              {/* 顶层：圆形边框指示裁剪区域 */}
              <Circle
                stroke={{ shapeStyle: "white", strokeStyle: { lineWidth: 2 } }}
                frame={{ width: CROP_SIZE, height: CROP_SIZE }}
                allowsHitTesting={false}
              />
            </ZStack>
          </VStack>
        </Section>
        
        {/* 缩放滑块 */}
        <Section>
          <HStack spacing={8} padding={{ leading: 16, trailing: 16, top: 4, bottom: 4 }}>
            <Text font="caption" foregroundStyle="secondaryLabel">小</Text>
            <Slider
              min={0}
              max={100}
              value={sliderValue}
              step={1}
              onChanged={handleSliderChange}
              label={<Text>缩放</Text>}
            />
            <Text font="caption" foregroundStyle="secondaryLabel">大</Text>
          </HStack>
        </Section>
        
        {/* 重置按钮 */}
        <Section>
          <Button action={handleReset} buttonStyle="bordered" controlSize="small">
            <Text font="subheadline">重置位置和缩放</Text>
          </Button>
        </Section>
        
        {/* 提示 */}
        <Section header={<Text>提示</Text>}>
          <Text font="caption" foregroundStyle="tertiaryLabel">
            拖拽移动图片，双指捏合或使用滑块缩放，白色圆圈内的区域将成为头像。
          </Text>
        </Section>
      </List>
    </NavigationStack>
  )
}