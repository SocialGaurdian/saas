import * as mongoose from 'mongoose';

import * as he from 'he';
import * as hljs from 'highlight.js';
import * as marked from 'marked';

import Discussion from './Discussion';
import Team from './Team';

mongoose.set('useFindAndModify', false);

const mongoSchema = new mongoose.Schema({
  createdUserId: {
    type: String,
    required: true,
  },
  discussionId: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  htmlContent: {
    type: String,
    required: true,
  },
  isEdited: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    required: true,
  },
  lastUpdatedAt: Date,
});

function markdownToHtml(content) {
  const renderer = new marked.Renderer();

  renderer.link = (href, title, text) => {
    const t = title ? ` title="${title}"` : '';

    if (text.startsWith('<code>@#')) {
      return `${text.replace('<code>@#', '<code>@')} `;
    }

    return `
      <a target="_blank" href="${href}" rel="noopener noreferrer"${t}>
        ${text}
        <i class="material-icons" style="font-size: 16px; vertical-align: baseline">
          launch
        </i>
      </a>
    `;
  };

  marked.setOptions({
    renderer,
    breaks: true,
    highlight(code, lang) {
      if (!lang) {
        return hljs.highlightAuto(code).value;
      }

      return hljs.highlight(lang, code).value;
    },
  });

  return marked(he.decode(content));
}

export interface PostDocument extends mongoose.Document {
  createdUserId: string;
  discussionId: string;
  content: string;
  isEdited: boolean;
  createdAt: Date;
  lastUpdatedAt: Date;
}

interface PostModel extends mongoose.Model<PostDocument> {
  getList({
    userId,
    discussionId,
  }: {
    userId: string;
    discussionId: string;
  }): Promise<PostDocument[]>;

  add({
    content,
    userId,
    discussionId,
  }: {
    content: string;
    userId: string;
    discussionId: string;
  }): Promise<PostDocument>;

  edit({
    content,
    userId,
    id,
  }: {
    content: string;
    userId: string;
    id: string;
  }): Promise<PostDocument>;

  uploadFile({
    userId,
    id,
    fileName,
    file,
  }: {
    userId: string;
    id: string;
    fileName: string;
    file: string;
  }): Promise<void>;

  delete({ userId, id }: { userId: string; id: string }): Promise<void>;
}

class PostClass extends mongoose.Model {
  public static async getList({ userId, discussionId }) {
    await this.checkPermission({ userId, discussionId });

    const filter: any = { discussionId };

    return this.find(filter).sort({ createdAt: 1 });
  }

  public static async add({ content, userId, discussionId }) {
    if (!content) {
      throw new Error('Bad data');
    }

    const htmlContent = markdownToHtml(content);

    const post = await this.create({
      createdUserId: userId,
      discussionId,
      content,
      htmlContent,
      createdAt: new Date(),
    });

    return post;
  }

  public static async edit({ content, userId, id }) {
    if (!content || !id) {
      throw new Error('Bad data');
    }

    const post = await this.findById(id)
      .select('createdUserId discussionId')
      .setOptions({ lean: true });

    await this.checkPermission({ userId, discussionId: post.discussionId, post });

    const htmlContent = markdownToHtml(content);

    const updatedObj = await this.findOneAndUpdate(
      { _id: id },
      { content, htmlContent, isEdited: true, lastUpdatedAt: new Date() },
      { runValidators: true, new: true },
    );

    return updatedObj;
  }

  public static async delete({ userId, id }) {
    if (!id) {
      throw new Error('Bad data');
    }

    const post = await this.findById(id)
      .select('createdUserId discussionId content')
      .setOptions({ lean: true });

    await this.checkPermission({ userId, discussionId: post.discussionId, post });

    await this.deleteOne({ _id: id });
  }

  public static async checkPermission({ userId, discussionId, post = null }) {
    if (!userId || !discussionId) {
      throw new Error('Bad data');
    }

    if (post && post.createdUserId !== userId) {
      throw new Error('Permission denied');
    }

    const discussion = await Discussion.findById(discussionId)
      .select('teamId memberIds slug')
      .setOptions({ lean: true });

    if (!discussion) {
      throw new Error('Discussion not found');
    }

    if (discussion.memberIds.indexOf(userId) === -1) {
      throw new Error('Permission denied');
    }

    const team = await Team.findById(discussion.teamId)
      .select('memberIds slug')
      .setOptions({ lean: true });

    if (!team || team.memberIds.indexOf(userId) === -1) {
      throw new Error('Team not found');
    }

    return { team, discussion };
  }
}

mongoSchema.loadClass(PostClass);

const Post = mongoose.model<PostDocument, PostModel>('Post', mongoSchema);

export default Post;
