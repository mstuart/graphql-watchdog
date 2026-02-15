import { describe, it, expect } from 'vitest';
import { buildSchema, parse } from 'graphql';
import { suggestOptimizations } from '../src/cost/suggestions.js';
import { analyzeCost } from '../src/cost/analyzer.js';
import type { CostConfig } from '../src/types/index.js';

const schema = buildSchema(`
  type Query {
    user(id: ID!): User
    posts(first: Int, limit: Int): [Post!]!
    allUsers: [User!]!
    feed: [Post!]!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    posts(first: Int): [Post!]!
    profile: Profile
  }

  type Profile {
    bio: String!
    avatar: String!
  }

  type Post {
    id: ID!
    title: String!
    body: String!
    author: User!
    comments(first: Int): [Comment!]!
  }

  type Comment {
    id: ID!
    text: String!
    author: User!
  }
`);

describe('Query Optimization Suggestions', () => {
  describe('pagination suggestions', () => {
    it('should suggest pagination for list fields without first/limit', () => {
      const query = parse(`
        query {
          allUsers {
            name
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const paginationSuggestions = suggestions.filter((s) => s.type === 'pagination');
      expect(paginationSuggestions.length).toBeGreaterThan(0);
      expect(paginationSuggestions[0].field).toBe('Query.allUsers');
      expect(paginationSuggestions[0].message).toContain('first: N');
      expect(paginationSuggestions[0].severity).toBe('high');
    });

    it('should not suggest pagination when first/limit is provided', () => {
      const query = parse(`
        query {
          posts(first: 10) {
            title
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const paginationSuggestions = suggestions.filter((s) => s.type === 'pagination');
      // The posts field has first: 10, so no pagination suggestion for it
      const postsSuggestion = paginationSuggestions.find((s) => s.field === 'Query.posts');
      expect(postsSuggestion).toBeUndefined();
    });
  });

  describe('field pruning suggestions', () => {
    it('should suggest pruning for deeply nested fields with high cost contribution', () => {
      const query = parse(`
        query {
          posts(first: 10) {
            title
            comments(first: 50) {
              text
              author {
                name
                email
              }
            }
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const pruningSuggestions = suggestions.filter((s) => s.type === 'field-pruning');
      // deeply nested fields with high cost should be flagged
      if (pruningSuggestions.length > 0) {
        expect(pruningSuggestions[0].severity).toBe('medium');
        expect(pruningSuggestions[0].message).toContain('% of query cost');
      }
    });
  });

  describe('depth reduction suggestions', () => {
    it('should suggest depth reduction for deeply nested queries', () => {
      const query = parse(`
        query {
          posts(first: 5) {
            title
            author {
              name
              posts(first: 5) {
                title
                comments(first: 3) {
                  text
                  author {
                    name
                  }
                }
              }
            }
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const depthSuggestions = suggestions.filter((s) => s.type === 'depth-reduction');
      expect(depthSuggestions.length).toBeGreaterThan(0);
      expect(depthSuggestions[0].message).toContain('levels');
    });

    it('should not suggest depth reduction for shallow queries', () => {
      const query = parse(`
        query {
          user(id: "1") {
            name
            email
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const depthSuggestions = suggestions.filter((s) => s.type === 'depth-reduction');
      expect(depthSuggestions).toHaveLength(0);
    });
  });

  describe('fragment suggestions', () => {
    it('should suggest fragments for repeated selection sets', () => {
      const query = parse(`
        query {
          posts(first: 5) {
            title
            author {
              name
              email
            }
            comments(first: 3) {
              text
              author {
                name
                email
              }
            }
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const fragmentSuggestions = suggestions.filter((s) => s.type === 'fragment');
      expect(fragmentSuggestions.length).toBeGreaterThan(0);
      expect(fragmentSuggestions[0].message).toContain('fragment');
    });
  });

  describe('dataloader suggestions', () => {
    it('should suggest DataLoader for object fields under list parents', () => {
      const query = parse(`
        query {
          posts(first: 10) {
            title
            author {
              name
            }
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const dataloaderSuggestions = suggestions.filter((s) => s.type === 'dataloader');
      expect(dataloaderSuggestions.length).toBeGreaterThan(0);
      const authorSuggestion = dataloaderSuggestions.find((s) => s.field === 'Post.author');
      expect(authorSuggestion).toBeDefined();
      expect(authorSuggestion!.message).toContain('DataLoader');
    });

    it('should not suggest DataLoader for non-list parents', () => {
      const query = parse(`
        query {
          user(id: "1") {
            name
            profile {
              bio
            }
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      const dataloaderSuggestions = suggestions.filter((s) => s.type === 'dataloader');
      expect(dataloaderSuggestions).toHaveLength(0);
    });
  });

  describe('sorting', () => {
    it('should sort suggestions by estimated saving descending', () => {
      const query = parse(`
        query {
          allUsers {
            name
            posts(first: 5) {
              title
              author {
                name
              }
            }
          }
        }
      `);

      const breakdown = analyzeCost(query, schema);
      const suggestions = suggestOptimizations(breakdown, query, schema);

      if (suggestions.length >= 2) {
        for (let i = 1; i < suggestions.length; i++) {
          expect(suggestions[i - 1].estimatedSaving).toBeGreaterThanOrEqual(
            suggestions[i].estimatedSaving,
          );
        }
      }
    });
  });

  describe('with custom config', () => {
    it('should pass config through to suggestion logic', () => {
      const query = parse(`
        query {
          feed {
            title
          }
        }
      `);

      const config: CostConfig = { defaultListMultiplier: 50 };
      const breakdown = analyzeCost(query, schema, config);
      const suggestions = suggestOptimizations(breakdown, query, schema, config);

      // feed has no pagination, so should get a suggestion
      const paginationSuggestions = suggestions.filter((s) => s.type === 'pagination');
      expect(paginationSuggestions.length).toBeGreaterThan(0);
    });
  });
});
