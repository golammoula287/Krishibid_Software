import type {
  ContactMessageDto,
  ContactMessageInput,
  CreatePostInput,
  Page,
  PostDto,
  UpdatePostInput,
} from '@krishibid/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from './api.js';
import { useToast } from './toast.js';

export const postsKey = ['posts'] as const;

/**
 * The blog list.
 *
 * Public, so this is one of the few queries that runs with no session. An admin hitting the same
 * endpoint also gets drafts — decided server-side from the verified role, so the client neither
 * asks for them nor has to filter them out.
 */
export function usePosts(tag?: string) {
  return useQuery({
    queryKey: [...postsKey, { tag: tag ?? null }],
    queryFn: () =>
      api.get<Page<PostDto>>(`/content/posts?limit=20${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`),
    // Announcements do not change minute to minute, and this is on the public path.
    staleTime: 5 * 60_000,
  });
}

export function usePost(slug: string) {
  return useQuery({
    queryKey: [...postsKey, slug],
    queryFn: () => api.get<PostDto>(`/content/posts/${slug}`),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Authoring — admin only; the API refuses these for anyone else
// ---------------------------------------------------------------------------

export function useCreatePost() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreatePostInput) => api.post<PostDto>('/content/posts', input),
    onSuccess: async (post) => {
      toast.showSuccess(post.status === 'published' ? 'post_published' : 'post_saved');
      await queryClient.invalidateQueries({ queryKey: postsKey });
    },
  });
}

export function useUpdatePost() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePostInput }) =>
      apiRequest<PostDto>(`/content/posts/${id}`, { method: 'PATCH', body: input }),
    onSuccess: async (post) => {
      toast.showSuccess(post.status === 'published' ? 'post_published' : 'post_saved');
      await queryClient.invalidateQueries({ queryKey: postsKey });
    },
  });
}

export function useDeletePost() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (id: string) => api.del(`/content/posts/${id}`),
    onSuccess: async () => {
      toast.showSuccess('post_deleted');
      await queryClient.invalidateQueries({ queryKey: postsKey });
    },
  });
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export function useSendContactMessage() {
  const toast = useToast();

  return useMutation({
    mutationFn: (input: ContactMessageInput) =>
      api.post<{ received: true }>('/content/contact', input),
    onSuccess: () => toast.showSuccess('message_sent'),
  });
}

export function useContactMessages() {
  return useQuery({
    queryKey: ['contact-messages'],
    queryFn: () => api.get<ContactMessageDto[]>('/content/contact/messages'),
  });
}
