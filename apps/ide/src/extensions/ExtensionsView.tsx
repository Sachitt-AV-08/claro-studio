import React, { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";

interface Extension {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  installed: boolean;
}

interface ExtensionCardProps {
  ext: Extension;
  onInstall: (id: string) => void;
}

const ExtensionCard: React.FC<ExtensionCardProps> = ({ ext, onInstall }) => {
  const iconMap: Record<string, IconName> = {
    ai: "sparkle",
    terminal: "terminal",
    design: "extensions",
    git: "git-branch",
    debug: "tools",
  };

  const installedSection = ext.installed ? (
    <div className="ext-card__sections">
      <section className="ext-section">
        <h4>Details</h4>
        <p className="ext-desc">{ext.description}</p>
        <div className="ext-meta">
          <span>Author: {ext.author}</span>
          <span>Version: {ext.version}</span>
          <span>Category: {ext.category}</span>
        </div>
      </section>
    </div>
  ) : null;

  return (
    <article className="ext-card">
      <div className="ext-card__head">
        <div className="ext-card__icon">
          <Icon name={iconMap[ext.category] || "plug"} size={20} />
        </div>
        <div className="ext-card__title">
          <span className="ext-card__name">{ext.name}</span>
          <span className="ext-card__pub">{ext.author} · v{ext.version} · {ext.category}</span>
          <span className="ext-card__desc">{ext.description}</span>
        </div>
        {ext.installed ? (
          <span className="ext-card__install ext-card__install--installed">Installed</span>
        ) : (
          <button
            className="ext-card__install"
            onClick={() => onInstall(ext.id)}
          >
            Install
          </button>
        )}
      </div>
      {installedSection}
    </article>
  );
};

export const ExtensionsView: React.FC = () => {
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadExtensions = async () => {
      try {
        const exts = await window.electronAPI?.claroSkillsList?.();
        if (exts) setExtensions(exts);
      } catch (e) {
        console.error("Failed to load extensions:", e);
      } finally {
        setLoading(false);
      }
    };
    loadExtensions();
  }, []);

  const handleInstall = async (id: string) => {
    try {
      const result = await window.electronAPI?.claroSkillsInstall?.(id);
      if (result?.ok) {
        setExtensions((prev) =>
          prev.map((e) => (e.id === id ? { ...e, installed: true } : e))
        );
      } else {
        alert(`Install failed: ${result?.error || "Unknown error"}`);
      }
    } catch (e) {
      alert(`Install error: ${e}`);
    }
  };

  return (
    <div className="extensions">
      <div className="pane__header">
        <span>Extensions</span>
        <span className="pane__sub">CHROME · {extensions.filter((e) => e.installed).length} INSTALLED</span>
      </div>

      {loading ? (
        <div className="extensions__loading">Loading extensions…</div>
      ) : (
        <div className="extensions__list">
          {extensions.map((ext) => (
            <ExtensionCard key={ext.id} ext={ext} onInstall={handleInstall} />
          ))}
        </div>
      )}
    </div>
  );
};