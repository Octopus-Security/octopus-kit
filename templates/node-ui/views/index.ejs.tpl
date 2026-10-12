<main class="app-main">
  <h1>{{NAME}}</h1>
  <p class="o-muted">Signed in as <strong><%= user.username %></strong>.</p>
  <section class="o-card">
    <h2>Integrations</h2>
    <p>Every integration is optional. A partner that is missing hides its feature:</p>
    <ul>
      <% Object.keys(suite).forEach(function (name) { %>
        <li><%= name %>: <%= suite[name] ? 'available' : 'not connected — its features are hidden' %></li>
      <% }) %>
    </ul>
  </section>
</main>
