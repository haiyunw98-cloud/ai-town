import { Component, type ErrorInfo, type ReactNode } from 'react';

export default class ObserverPanelBoundary extends Component<{
  children: ReactNode;
  onRetry: () => void;
}, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Observer panel failed without unmounting the town map', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="observer-panel-error" role="alert">
        <strong>观察台暂时忙碌</strong>
        <p>地图和居民仍在运行。大型记录读取超时不会再让整个小镇掉线。</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: undefined });
            this.props.onRetry();
          }}
        >
          重新加载观察台
        </button>
      </section>
    );
  }
}
