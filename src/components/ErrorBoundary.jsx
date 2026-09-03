import React from 'react';

// Keeps a crash inside one panel from taking the whole page down with it —
// the 3D preview in particular touches WebGL, which fails in ways React
// cannot anticipate.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Panel crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="note error">
        <strong>{this.props.title || 'Something went wrong here.'}</strong>
        <div style={{ marginTop: 6 }}>{this.state.error.message}</div>
        {this.props.hint && <div style={{ marginTop: 6 }}>{this.props.hint}</div>}
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
