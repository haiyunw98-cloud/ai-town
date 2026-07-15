// Based on https://codepen.io/inlet/pen/yLVmPWv.
// Copyright (c) 2018 Patrick Brouwer, distributed under the MIT license.

import { PixiComponent, useApp } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { MutableRefObject, ReactNode } from 'react';
import { initialViewportScale } from './viewportMath';

export type ViewportProps = {
  app: Application;
  viewportRef?: MutableRefObject<Viewport | undefined>;

  screenWidth: number;
  screenHeight: number;
  worldWidth: number;
  worldHeight: number;
  children?: ReactNode;
};

// https://davidfig.github.io/pixi-viewport/jsdoc/Viewport.html
export default PixiComponent('Viewport', {
  create(props: ViewportProps) {
    const { app, children, viewportRef, ...viewportProps } = props;
    const viewport = new Viewport({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      events: app.renderer.events,
      passiveWheel: false,
      ...viewportProps,
    });
    if (viewportRef) {
      viewportRef.current = viewport;
    }
    // Activate plugins
    const minScale = initialViewportScale(
      props.screenWidth,
      props.screenHeight,
      props.worldWidth,
      props.worldHeight,
    );
    viewport
      .drag()
      .pinch({})
      .wheel()
      .decelerate()
      .clamp({ direction: 'all', underflow: 'center' })
      .clampZoom({
        minScale,
        maxScale: 3.0,
      });
    viewport.setZoom(minScale, true);
    viewport.moveCenter(props.worldWidth / 2, props.worldHeight / 2);
    return viewport;
  },
  applyProps(viewport, oldProps: any, newProps: any) {
    const sizeChanged =
      oldProps.screenWidth !== newProps.screenWidth ||
      oldProps.screenHeight !== newProps.screenHeight ||
      oldProps.worldWidth !== newProps.worldWidth ||
      oldProps.worldHeight !== newProps.worldHeight;

    if (sizeChanged && newProps.screenWidth > 0 && newProps.screenHeight > 0) {
      // pixi-viewport's public size fields do not recalculate its hit area or
      // camera by themselves. The observer panel changes the canvas without a
      // browser resize, so explicitly resize and reframe the town here.
      viewport.resize(
        newProps.screenWidth,
        newProps.screenHeight,
        newProps.worldWidth,
        newProps.worldHeight,
      );
      const minScale = initialViewportScale(
        newProps.screenWidth,
        newProps.screenHeight,
        newProps.worldWidth,
        newProps.worldHeight,
      );
      viewport.plugins.get('clamp-zoom')?.options &&
        (viewport.plugins.get('clamp-zoom')!.options.minScale = minScale);
      viewport.setZoom(minScale, true);
      viewport.moveCenter(newProps.worldWidth / 2, newProps.worldHeight / 2);
    }
    Object.keys(newProps).forEach((p) => {
      if (p !== 'app' && p !== 'viewportRef' && p !== 'children' && oldProps[p] !== newProps[p]) {
        // @ts-expect-error Ignoring TypeScript here
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        viewport[p] = newProps[p];
      }
    });
  },
});
