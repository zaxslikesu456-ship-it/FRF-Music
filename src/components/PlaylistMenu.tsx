import { FolderOpen, Play, Shuffle, Pencil, Trash2, ImagePlus, ImageOff } from 'lucide-react';
import { pickImage } from '../utils/pickImage';
import { t as tr } from '../i18n';
import { useAudio } from '../context/AudioContext';
import { useContextMenu } from './ContextMenu';
import type { Playlist, Track } from '../types/music';

/**
 * Right-click (long press on phones) menu for one of your playlists:
 * open, play, shuffle, rename, delete. Render `element` once; call
 * `open(e, playlist, onOpen)` from onContextMenu.
 */
export function usePlaylistMenu() {
  const { playQueue, trackStore, tracks, isShuffle, toggleShuffle, renamePlaylist, deletePlaylist, setPlaylistCover } = useAudio();
  const menu = useContextMenu();

  const songsOf = (pl: Playlist): Track[] =>
    pl.trackIds
      .map(id => trackStore[id] || tracks.find(t => t.id === id))
      .filter((t): t is Track => Boolean(t));

  const open = (e: React.MouseEvent, pl: Playlist, onOpen?: () => void) => {
    const songs = songsOf(pl);
    menu.open(e, [
      ...(onOpen ? [{ label: tr('Open'), icon: FolderOpen, onClick: onOpen }] : []),
      ...(songs.length > 0
        ? [
            {
              label: tr('Play'),
              icon: Play,
              onClick: () => {
                if (isShuffle) toggleShuffle();
                playQueue(songs, 0);
              },
            },
            {
              label: tr('Shuffle'),
              icon: Shuffle,
              onClick: () => {
                if (!isShuffle) toggleShuffle();
                playQueue(songs, Math.floor(Math.random() * songs.length));
              },
            },
          ]
        : []),
      {
        label: tr('Rename Playlist'),
        icon: Pencil,
        onClick: () => {
          const name = prompt(tr('Rename Playlist'), pl.name);
          if (name && name.trim()) renamePlaylist(pl.id, name.trim());
        },
      },
      {
        label: tr('Change picture'),
        icon: ImagePlus,
        onClick: async () => {
          const picture = await pickImage();
          if (picture) setPlaylistCover(pl.id, picture);
        },
      },
      ...(pl.coverUrl
        ? [{ label: tr('Use original picture'), icon: ImageOff, onClick: () => setPlaylistCover(pl.id, null) }]
        : []),
      {
        label: tr('Delete Playlist'),
        icon: Trash2,
        danger: true,
        onClick: () => {
          if (confirm(tr('Delete playlist "{name}"?', { name: pl.name }))) deletePlaylist(pl.id);
        },
      },
    ]);
  };

  return { open, element: menu.element };
}
