import { BaseTexture, ISpritesheetData, Spritesheet } from 'pixi.js';
import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatedSprite, Container, Graphics, Text, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';

const spriteSheetCache = new Map<string, Promise<Spritesheet>>();

function loadSpriteSheet(textureUrl: string, spritesheetData: ISpritesheetData) {
  const firstFrame = Object.values(spritesheetData.frames)[0]?.frame;
  const namespace = `resident-${firstFrame?.x ?? 0}-${firstFrame?.y ?? 0}`;
  const cacheKey = `${textureUrl}:${namespace}`;
  let pending = spriteSheetCache.get(cacheKey);
  if (!pending) {
    const frames = Object.fromEntries(
      Object.entries(spritesheetData.frames).map(([name, frame]) => [`${namespace}:${name}`, frame]),
    );
    const animations = Object.fromEntries(
      Object.entries(spritesheetData.animations ?? {}).map(([name, frameNames]) => [
        name,
        frameNames.map((frameName) => `${namespace}:${frameName}`),
      ]),
    );
    pending = (async () => {
      const sheet = new Spritesheet(
        BaseTexture.from(textureUrl, { scaleMode: PIXI.SCALE_MODES.NEAREST }),
        { ...spritesheetData, frames, animations },
      );
      await sheet.parse();
      return sheet;
    })();
    spriteSheetCache.set(cacheKey, pending);
  }
  return pending;
}

export const Character = ({
  textureUrl,
  spritesheetData,
  x,
  y,
  orientation,
  isMoving = false,
  isThinking = false,
  isSpeaking = false,
  isOnFerry = false,
  emoji = '',
  isViewer = false,
  speed = 0.1,
  displayName,
  statusLabel,
  onClick,
}: {
  // Path to the texture packed image.
  textureUrl: string;
  // The data for the spritesheet.
  spritesheetData: ISpritesheetData;
  // The pose of the NPC.
  x: number;
  y: number;
  orientation: number;
  isMoving?: boolean;
  // Shows a thought bubble if true.
  isThinking?: boolean;
  // Shows a speech bubble if true.
  isSpeaking?: boolean;
  isOnFerry?: boolean;
  emoji?: string;
  // Highlights the player.
  isViewer?: boolean;
  // The speed of the animation. Can be tuned depending on the side and speed of the NPC.
  speed?: number;
  displayName: string;
  statusLabel: string;
  onClick: () => void;
}) => {
  const [spriteSheet, setSpriteSheet] = useState<Spritesheet>();
  useEffect(() => {
    let cancelled = false;
    void loadSpriteSheet(textureUrl, spritesheetData).then((sheet) => {
      if (!cancelled) setSpriteSheet(sheet);
    });
    return () => {
      cancelled = true;
    };
  }, [textureUrl, spritesheetData]);

  // The first "left" is "right" but reflected.
  const roundedOrientation = Math.floor(orientation / 90);
  const direction = ['right', 'down', 'left', 'up'][roundedOrientation];

  // Prevents the animation from stopping when the texture changes
  // (see https://github.com/pixijs/pixi-react/issues/359)
  const ref = useRef<PIXI.AnimatedSprite | null>(null);
  const containerRef = useRef<PIXI.Container | null>(null);
  const idlePhase = useRef([...displayName].reduce((sum, value) => sum + value.charCodeAt(0), 0));
  useTick(() => {
    if (!containerRef.current || isMoving) return;
    containerRef.current.y = y + Math.sin(Date.now() / 380 + idlePhase.current) * 1.2;
  });
  useEffect(() => {
    if (isMoving) {
      ref.current?.play();
    }
  }, [direction, isMoving]);

  if (!spriteSheet) return null;

  let blockOffset = { x: 0, y: 0 };
  switch (roundedOrientation) {
    case 2:
      blockOffset = { x: -20, y: 0 };
      break;
    case 0:
      blockOffset = { x: 20, y: 0 };
      break;
    case 3:
      blockOffset = { x: 0, y: -20 };
      break;
    case 1:
      blockOffset = { x: 0, y: 20 };
      break;
  }

  return (
    <Container ref={containerRef} x={x} y={y} interactive={true} pointerdown={onClick} cursor="pointer">
      <Text
        x={0}
        y={-31}
        text={displayName}
        anchor={{ x: 0.5, y: 0.5 }}
        style={new PIXI.TextStyle({
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: 17,
          fontWeight: '700',
          fill: 0xfff1c7,
          stroke: 0x102d31,
          strokeThickness: 4,
        })}
      />
      <Text
        x={0}
        y={-20}
        text={statusLabel}
        anchor={{ x: 0.5, y: 0.5 }}
        style={new PIXI.TextStyle({
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          fontSize: 10,
          fill: 0xd9c88b,
          stroke: 0x102d31,
          strokeThickness: 3,
        })}
      />
      {isThinking && (
        // TODO: We'll eventually have separate assets for thinking and speech animations.
        <Text x={-20} y={-10} scale={{ x: -0.8, y: 0.8 }} text={'💭'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isSpeaking && (
        // TODO: We'll eventually have separate assets for thinking and speech animations.
        <Text x={18} y={-10} scale={0.8} text={'💬'} anchor={{ x: 0.5, y: 0.5 }} />
      )}
      {isViewer && <ViewerIndicator />}
      {isOnFerry && (
        <Graphics
          draw={(graphics) => {
            graphics.clear();
            graphics.beginFill(0x6e3d24, 0.98);
            graphics.drawRoundedRect(-19, 8, 38, 11, 5);
            graphics.endFill();
            graphics.beginFill(0xe6b760, 0.95);
            graphics.drawRect(-13, 5, 26, 4);
            graphics.endFill();
            graphics.lineStyle(2, 0x32180f, 0.9);
            graphics.moveTo(-19, 15);
            graphics.lineTo(19, 15);
          }}
        />
      )}
      <AnimatedSprite
        ref={ref}
        isPlaying={isMoving}
        textures={spriteSheet.animations[direction]}
        animationSpeed={speed}
        anchor={{ x: 0.5, y: 0.5 }}
        scale={1.2}
      />
      {emoji && (
        <Text x={0} y={-24} scale={{ x: -0.8, y: 0.8 }} text={emoji} anchor={{ x: 0.5, y: 0.5 }} />
      )}
    </Container>
  );
};

function ViewerIndicator() {
  const draw = useCallback((g: PIXI.Graphics) => {
    g.clear();
    g.beginFill(0xffff0b, 0.5);
    g.drawRoundedRect(-10, 10, 20, 10, 100);
    g.endFill();
  }, []);

  return <Graphics draw={draw} />;
}
