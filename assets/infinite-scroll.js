(() => {
  let loading = false;

  function getCurrentPage() {
    return (
      Number(
        document
          .querySelector(".pagination__item--current")
          ?.textContent.trim(),
      ) || 1
    );
  }

  function getNextLink() {
    const currentPage = getCurrentPage();

    const links = [
      ...document.querySelectorAll(".pagination a[href*='page=']"),
    ];

    return links.find((link) => {
      const url = new URL(link.href);
      return Number(url.searchParams.get("page")) === currentPage + 1;
    });
  }

  function addButton() {
    const oldButton = document.querySelector(".load-more-button");
    if (oldButton) oldButton.remove();

    const nextLink = getNextLink();
    if (!nextLink) return;

    const gridContainer =
      document.querySelector("#ProductGridContainer") ||
      document.querySelector(".collection");

    if (!gridContainer) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "load-more-button button";
    button.textContent = "לראות עוד";

    button.addEventListener("click", loadMore);

    gridContainer.appendChild(button);
  }

  async function loadMore(event) {
    if (loading) return;

    const button = event.currentTarget;
    const nextLink = getNextLink();

    if (!nextLink) {
      button.remove();
      return;
    }

    loading = true;
    button.textContent = "טוען...";

    try {
      const response = await fetch(nextLink.href);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const currentGrid = document.querySelector("#product-grid");
      const newProducts = doc.querySelectorAll("#product-grid .grid__item");

      if (!currentGrid || !newProducts.length) {
        button.remove();
        return;
      }

      newProducts.forEach((product) => {
        currentGrid.appendChild(product);
      });

      const newPagination = doc.querySelector(".infinite-scroll-pagination");
      const currentPagination = document.querySelector(
        ".infinite-scroll-pagination",
      );

      if (newPagination && currentPagination) {
        currentPagination.innerHTML = newPagination.innerHTML;
      } else if (currentPagination) {
        currentPagination.remove();
      }

      addButton();
    } catch (error) {
      console.error("Load more error:", error);
      button.textContent = "שגיאה, נסי שוב";
    }

    loading = false;
  }

  document.addEventListener("DOMContentLoaded", addButton);

  const observer = new MutationObserver(() => {
    clearTimeout(window.loadMoreButtonTimer);
    window.loadMoreButtonTimer = setTimeout(addButton, 400);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
})();
